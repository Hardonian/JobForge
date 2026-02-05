import { describe, expect, it } from 'vitest'
import { calculateNextHeartbeatInterval } from '../src/lib/heartbeat'

describe('calculateNextHeartbeatInterval', () => {
  it('backs off and caps at max interval', () => {
    const baseIntervalMs = 30000
    const maxIntervalMs = 120000
    const backoffMultiplier = 2

    let currentIntervalMs = baseIntervalMs
    currentIntervalMs = calculateNextHeartbeatInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      backoffMultiplier,
    })
    expect(currentIntervalMs).toBe(60000)

    currentIntervalMs = calculateNextHeartbeatInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      backoffMultiplier,
    })
    expect(currentIntervalMs).toBe(120000)

    currentIntervalMs = calculateNextHeartbeatInterval({
      currentIntervalMs,
      baseIntervalMs,
      maxIntervalMs,
      backoffMultiplier,
    })
    expect(currentIntervalMs).toBe(120000)
  })
})
