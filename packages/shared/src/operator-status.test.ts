import { describe, expect, it } from 'vitest'
import { buildOperatorStatus } from './operator-status.js'

describe('operator status evidence', () => {
  it('separates retryable and terminal failures', () => {
    const report = buildOperatorStatus([
      { id: 'a', status: 'failed', retryCount: 1, maxRetries: 3, error: 'timeout' },
      { id: 'b', status: 'failed', retryCount: 3, maxRetries: 3, error: 'invalid input' },
      { id: 'c', status: 'completed' },
    ], '2026-01-01T00:00:00.000Z')
    expect(report.total).toBe(3)
    expect(report.byStatus.failed).toBe(2)
    expect(report.retryableFailures.map((item) => item.id)).toEqual(['a'])
    expect(report.terminalFailures.map((item) => item.id)).toEqual(['b'])
  })
})
