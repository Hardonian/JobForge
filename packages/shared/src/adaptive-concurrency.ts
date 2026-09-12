/**
 * JobForge Adaptive Concurrency Controller
 * Implements Additive Increase / Multiplicative Decrease (AIMD) based on Little's Law.
 * Dynamically adjusts worker job claim batch size and execution limits based on
 * observed latency and upstream database/API backpressure.
 */

export interface AdaptiveConcurrencyOptions {
  /** Minimum concurrency limit (default: 1) */
  minConcurrency?: number
  /** Maximum concurrency limit (default: 50) */
  maxConcurrency?: number
  /** Target p90 latency in milliseconds (default: 1000ms) */
  targetLatencyMs?: number
  /** Additive increase step when healthy (default: 1) */
  additiveStep?: number
  /** Multiplicative decrease factor under congestion (default: 0.5) */
  backoffFactor?: number
  /** Concurrency adjustment cooldown window in ms (default: 5000ms) */
  adjustmentWindowMs?: number
}

export interface ConcurrencyMetrics {
  currentLimit: number
  sampleCount: number
  averageLatencyMs: number
  errorRate: number
  lastAdjustedAt: number
}

export class AdaptiveConcurrencyController {
  private minConcurrency: number
  private maxConcurrency: number
  private targetLatencyMs: number
  private additiveStep: number
  private backoffFactor: number
  private adjustmentWindowMs: number

  private currentLimit: number
  private latencies: number[] = []
  private errorsCount = 0
  private successesCount = 0
  private lastAdjustedAt: number = Date.now()

  constructor(options: AdaptiveConcurrencyOptions = {}) {
    this.minConcurrency = Math.max(1, options.minConcurrency ?? 1)
    this.maxConcurrency = Math.max(this.minConcurrency, options.maxConcurrency ?? 50)
    this.targetLatencyMs = options.targetLatencyMs ?? 1000
    this.additiveStep = options.additiveStep ?? 1
    this.backoffFactor = options.backoffFactor ?? 0.5
    this.adjustmentWindowMs = options.adjustmentWindowMs ?? 5000

    this.currentLimit = Math.min(10, this.maxConcurrency)
  }

  /**
   * Get current dynamic concurrency limit
   */
  getConcurrencyLimit(): number {
    return Math.round(this.currentLimit)
  }

  /**
   * Record a successful job execution with duration
   */
  recordSuccess(durationMs: number): void {
    this.successesCount++
    this.latencies.push(durationMs)
    if (this.latencies.length > 100) {
      this.latencies.shift()
    }
    this.evaluateLimits()
  }

  /**
   * Record a failed job execution (error or timeout)
   */
  recordFailure(): void {
    this.errorsCount++
    this.evaluateLimits()
  }

  /**
   * Evaluate metrics and adjust limits if window has elapsed
   */
  private evaluateLimits(): void {
    const now = Date.now()
    if (now - this.lastAdjustedAt < this.adjustmentWindowMs) {
      return
    }

    const totalSamples = this.successesCount + this.errorsCount
    if (totalSamples < 5) {
      return // Insufficient sample size
    }

    const errorRate = this.errorsCount / totalSamples
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((acc, v) => acc + v, 0) / this.latencies.length
        : 0

    // Congestion detected: High error rate (>15%) or latency exceeding 1.5x target
    if (errorRate > 0.15 || avgLatency > this.targetLatencyMs * 1.5) {
      const nextLimit = Math.max(this.minConcurrency, this.currentLimit * this.backoffFactor)
      this.currentLimit = nextLimit
    } else if (avgLatency < this.targetLatencyMs && errorRate < 0.05) {
      // Healthy: Additive Increase
      const nextLimit = Math.min(this.maxConcurrency, this.currentLimit + this.additiveStep)
      this.currentLimit = nextLimit
    }

    // Reset window counters
    this.latencies = []
    this.errorsCount = 0
    this.successesCount = 0
    this.lastAdjustedAt = now
  }

  /**
   * Retrieve snapshot of concurrency telemetry
   */
  getMetrics(): ConcurrencyMetrics {
    const totalSamples = this.successesCount + this.errorsCount
    const avgLatency =
      this.latencies.length > 0
        ? this.latencies.reduce((acc, v) => acc + v, 0) / this.latencies.length
        : 0
    const errorRate = totalSamples > 0 ? this.errorsCount / totalSamples : 0

    return {
      currentLimit: this.getConcurrencyLimit(),
      sampleCount: totalSamples,
      averageLatencyMs: Math.round(avgLatency),
      errorRate,
      lastAdjustedAt: this.lastAdjustedAt,
    }
  }

  /**
   * Reset controller state
   */
  reset(): void {
    this.currentLimit = Math.min(10, this.maxConcurrency)
    this.latencies = []
    this.errorsCount = 0
    this.successesCount = 0
    this.lastAdjustedAt = Date.now()
  }
}
