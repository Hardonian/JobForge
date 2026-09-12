/**
 * JobForge Resilient Circuit Breaker
 * Protects downstream services, AI adapters, and external APIs from cascade failures.
 * Implements standard Closed -> Open -> Half-Open state transitions with backoff.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN'

export interface CircuitBreakerOptions {
  /** Number of consecutive failures to trigger OPEN state (default: 5) */
  failureThreshold?: number
  /** Time in milliseconds to remain in OPEN before transitioning to HALF_OPEN (default: 30000ms) */
  resetTimeoutMs?: number
  /** Number of successful calls in HALF_OPEN to transition to CLOSED (default: 2) */
  halfOpenSuccessThreshold?: number
  /** Name of the protected service for logging and metrics */
  name?: string
  /** Callback fired when circuit changes state */
  onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void
}

export class CircuitBreakerOpenError extends Error {
  constructor(serviceName: string, remainingResetMs: number) {
    super(
      `Circuit breaker for "${serviceName}" is OPEN. Requests short-circuited for ${Math.round(remainingResetMs / 1000)}s.`
    )
    this.name = 'CircuitBreakerOpenError'
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED'
  private failureCount = 0
  private consecutiveSuccesses = 0
  private lastFailureTime = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly halfOpenSuccessThreshold: number
  private readonly name: string
  private readonly onStateChange?: (from: CircuitState, to: CircuitState, name: string) => void

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30000
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2
    this.name = options.name ?? 'default-service'
    this.onStateChange = options.onStateChange
  }

  /**
   * Current circuit state
   */
  getState(): CircuitState {
    if (this.state === 'OPEN') {
      const now = Date.now()
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this.transitionTo('HALF_OPEN')
      }
    }
    return this.state
  }

  /**
   * Execute an async action protected by this circuit breaker
   */
  async execute<T>(action: () => Promise<T>, fallback?: (error: Error) => Promise<T>): Promise<T> {
    const currentState = this.getState()

    if (currentState === 'OPEN') {
      const remainingReset = Math.max(0, this.resetTimeoutMs - (Date.now() - this.lastFailureTime))
      const openError = new CircuitBreakerOpenError(this.name, remainingReset)
      if (fallback) {
        return fallback(openError)
      }
      throw openError
    }

    try {
      const result = await action()
      this.handleSuccess()
      return result
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      this.handleFailure()
      if (fallback) {
        return fallback(err)
      }
      throw err
    }
  }

  private handleSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.consecutiveSuccesses++
      if (this.consecutiveSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo('CLOSED')
        this.failureCount = 0
        this.consecutiveSuccesses = 0
      }
    } else if (this.state === 'CLOSED') {
      this.failureCount = 0
    }
  }

  private handleFailure(): void {
    this.lastFailureTime = Date.now()
    if (this.state === 'HALF_OPEN') {
      // Re-trip circuit immediately if a probe fails during HALF_OPEN
      this.transitionTo('OPEN')
      this.consecutiveSuccesses = 0
    } else if (this.state === 'CLOSED') {
      this.failureCount++
      if (this.failureCount >= this.failureThreshold) {
        this.transitionTo('OPEN')
      }
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      const oldState = this.state
      this.state = newState
      if (this.onStateChange) {
        this.onStateChange(oldState, newState, this.name)
      }
    }
  }

  /**
   * Retrieve circuit breaker metrics
   */
  getMetrics() {
    return {
      name: this.name,
      state: this.getState(),
      failureCount: this.failureCount,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailureTime: this.lastFailureTime,
    }
  }

  /**
   * Manually reset the circuit breaker to CLOSED
   */
  reset(): void {
    this.transitionTo('CLOSED')
    this.failureCount = 0
    this.consecutiveSuccesses = 0
    this.lastFailureTime = 0
  }
}
