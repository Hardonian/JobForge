import { describe, expect, it } from 'vitest'
import { calculateNextPollInterval } from '../src/lib/polling'

describe('calculateNextPollInterval', () => {
  it('backs off when idle and caps at max interval', () => {
    const baseIntervalMs = 2000
    const maxIntervalMs = 10000
    const idleBackoffMultiplier = 2

    let currentIntervalMs = baseIntervalMs

    currentIntervalMs = calculateNextPollInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      idleBackoffMultiplier,
      jobsClaimed: 0,
    })
    expect(currentIntervalMs).toBe(4000)

    currentIntervalMs = calculateNextPollInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      idleBackoffMultiplier,
      jobsClaimed: 0,
    })
    expect(currentIntervalMs).toBe(8000)

    currentIntervalMs = calculateNextPollInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      idleBackoffMultiplier,
      jobsClaimed: 0,
    })
    expect(currentIntervalMs).toBe(10000)
  })

  it('resets to base interval after claiming jobs', () => {
    const baseIntervalMs = 2000
    const maxIntervalMs = 10000

    const nextIntervalMs = calculateNextPollInterval({
      currentIntervalMs: 8000,
      baseIntervalMs,
      maxIntervalMs,
      idleBackoffMultiplier: 2,
      jobsClaimed: 3,
    })

    expect(nextIntervalMs).toBe(baseIntervalMs)
  })

  it('maintains base interval when max equals base', () => {
    const baseIntervalMs = 2000
    const nextIntervalMs = calculateNextPollInterval({
      currentIntervalMs: baseIntervalMs,
      baseIntervalMs,
      maxIntervalMs: baseIntervalMs,
      idleBackoffMultiplier: 2,
      jobsClaimed: 0,
    })

    expect(nextIntervalMs).toBe(baseIntervalMs)
  })
})
