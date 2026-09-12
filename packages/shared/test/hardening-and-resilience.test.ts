import { describe, it, expect, vi } from 'vitest'
import {
  AdaptiveConcurrencyController,
  CircuitBreaker,
  CircuitBreakerOpenError,
  PoisonPillDetector,
  compressPayload,
  decompressPayload,
  isCompressedPayload,
} from '../src/index.js'

describe('AdaptiveConcurrencyController', () => {
  it('initializes with default concurrency and respects min/max boundaries', () => {
    const controller = new AdaptiveConcurrencyController({
      minConcurrency: 2,
      maxConcurrency: 20,
    })

    expect(controller.getConcurrencyLimit()).toBe(10)
    expect(controller.getMetrics().currentLimit).toBe(10)
  })

  it('adjusts limits based on latency and error rate', () => {
    const controller = new AdaptiveConcurrencyController({
      minConcurrency: 1,
      maxConcurrency: 15,
      targetLatencyMs: 100,
      adjustmentWindowMs: 0, // Instant adjustment for testing
      additiveStep: 2,
      backoffFactor: 0.5,
    })

    // Record healthy samples
    for (let i = 0; i < 6; i++) {
      controller.recordSuccess(50)
    }
    expect(controller.getConcurrencyLimit()).toBeGreaterThan(10)

    // Record heavy congestion
    for (let i = 0; i < 6; i++) {
      controller.recordFailure()
    }
    expect(controller.getConcurrencyLimit()).toBeLessThan(10)
  })
})

describe('CircuitBreaker', () => {
  it('allows executions when CLOSED and trips to OPEN on consecutive failures', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeoutMs: 100,
      name: 'test-adapter',
    })

    expect(breaker.getState()).toBe('CLOSED')

    const failingAction = vi.fn().mockRejectedValue(new Error('Network timeout'))

    // 1st failure
    await expect(breaker.execute(failingAction)).rejects.toThrow('Network timeout')
    expect(breaker.getState()).toBe('CLOSED')

    // 2nd failure
    await expect(breaker.execute(failingAction)).rejects.toThrow('Network timeout')
    expect(breaker.getState()).toBe('CLOSED')

    // 3rd failure -> Trips to OPEN
    await expect(breaker.execute(failingAction)).rejects.toThrow('Network timeout')
    expect(breaker.getState()).toBe('OPEN')

    // Subsequent call short-circuits with CircuitBreakerOpenError without calling action
    await expect(breaker.execute(failingAction)).rejects.toThrow(CircuitBreakerOpenError)
    expect(failingAction).toHaveBeenCalledTimes(3)
  })

  it('recovers to HALF_OPEN after timeout and closes on success', async () => {
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      resetTimeoutMs: 50,
      halfOpenSuccessThreshold: 1,
      name: 'recovery-service',
    })

    await expect(breaker.execute(() => Promise.reject(new Error('err')))).rejects.toThrow()
    await expect(breaker.execute(() => Promise.reject(new Error('err')))).rejects.toThrow()
    expect(breaker.getState()).toBe('OPEN')

    // Wait for reset timeout
    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(breaker.getState()).toBe('HALF_OPEN')

    // Successful probe restores circuit to CLOSED
    const result = await breaker.execute(async () => 'restored')
    expect(result).toBe('restored')
    expect(breaker.getState()).toBe('CLOSED')
  })
})

describe('PoisonPillDetector', () => {
  it('flags quarantine when a job causes multiple consecutive abnormal crashes', () => {
    const detector = new PoisonPillDetector({
      maxConsecutiveAbnormalCrashes: 2,
      maxTotalAttempts: 5,
    })

    const jobId = 'job-fatal-crash-123'

    // First crash
    const firstCheck = detector.assess(jobId, 1, false)
    expect(firstCheck.action).toBe('PROCEED')
    expect(firstCheck.isPoison).toBe(false)

    // Second crash -> Quarantine triggered
    const secondCheck = detector.assess(jobId, 2, false)
    expect(secondCheck.action).toBe('QUARANTINE')
    expect(secondCheck.isPoison).toBe(true)
    expect(secondCheck.reason).toContain('consecutive abnormal worker crashes')
  })

  it('clears crash history when job succeeds', () => {
    const detector = new PoisonPillDetector()
    const jobId = 'job-recovering-456'

    detector.assess(jobId, 1, false)
    expect(detector.getTrackedCount()).toBe(1)

    detector.recordSuccess(jobId)
    expect(detector.getTrackedCount()).toBe(0)
  })
})

describe('PayloadCompression', () => {
  it('leaves small payloads uncompressed', () => {
    const smallData = { greeting: 'hello world', count: 42 }
    const result = compressPayload(smallData, 2048)
    expect(isCompressedPayload(result)).toBe(false)
    expect(result).toEqual(smallData)
  })

  it('compresses payloads exceeding threshold and decompresses back accurately', () => {
    // Generate a payload > 2KB
    const largeData = {
      context: 'x'.repeat(4000),
      items: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item-${i}` })),
    }

    const compressed = compressPayload(largeData, 1000)
    expect(isCompressedPayload(compressed)).toBe(true)
    if (isCompressedPayload(compressed)) {
      expect(compressed.__alg).toBe('gzip')
      expect(compressed.__compressed_size_bytes).toBeLessThan(compressed.__original_size_bytes)
    }

    const decompressed = decompressPayload(compressed)
    expect(decompressed).toEqual(largeData)
  })
})
