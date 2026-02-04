import type { RetryConfig } from './types'

/**
 * Default retry configuration
 * Optimized: tighter timeouts, faster backoff to avoid thundering herd
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelay: 500, // Reduced from 1000ms for faster recovery
  maxDelay: 10000, // Reduced from 30000ms to fail faster
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  shouldRetry: () => true,
}

/**
 * Aggressive retry config for idempotent operations
 */
export const AGGRESSIVE_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 5,
  initialDelay: 300,
  maxDelay: 5000,
  backoffMultiplier: 1.5, // Slower growth for faster initial retries
  retryableStatusCodes: [408, 429, 500, 502, 503, 504, 502, 503, 504],
  shouldRetry: () => true,
}

/**
 * Conservative retry config for non-idempotent operations
 */
export const CONSERVATIVE_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 1,
  initialDelay: 1000,
  maxDelay: 5000,
  backoffMultiplier: 2,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  shouldRetry: () => true,
}

/**
 * Calculate delay for next retry attempt using exponential backoff with jitter
 */
export function calculateRetryDelay(attempt: number, config: Required<RetryConfig>): number {
  const exponentialDelay = config.initialDelay * Math.pow(config.backoffMultiplier, attempt - 1)
  const delayWithCap = Math.min(exponentialDelay, config.maxDelay)

  // Add jitter (±25% randomization) to prevent thundering herd
  const jitter = delayWithCap * 0.25 * (Math.random() * 2 - 1)
  return Math.floor(delayWithCap + jitter)
}

/**
 * Check if an HTTP status code should trigger a retry
 */
export function isRetryableStatus(status: number, retryableStatusCodes: number[]): boolean {
  return retryableStatusCodes.includes(status)
}

/**
 * Check if an error should trigger a retry
 */
export function isRetryableError(error: Error): boolean {
  // Network errors
  if (error.name === 'TypeError' && error.message.includes('fetch')) {
    return true
  }

  // Timeout errors
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true
  }

  // Connection errors
  if (
    error.message.includes('ECONNRESET') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND')
  ) {
    return true
  }

  return false
}

/**
 * Sleep for specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
