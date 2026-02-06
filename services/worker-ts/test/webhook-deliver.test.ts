import { describe, expect, it } from 'vitest'
import { webhookDeliverHandler } from '../src/handlers/webhook-deliver'

describe('webhookDeliverHandler', () => {
  it('rejects unsafe webhook targets', async () => {
    await expect(
      webhookDeliverHandler(
        {
          target_url: 'http://localhost/webhook',
          event_type: 'job.completed',
          event_id: '1f7a3e2e-4c0b-4c49-9b1b-2a4a3b9a6b6d',
          data: { ok: true },
        },
        {
          attempt_no: 1,
          job_id: 'job-123',
          tenant_id: 'tenant-123',
          trace_id: 'trace-123',
          heartbeat: async () => undefined,
        }
      )
    ).rejects.toThrow('Unsafe webhook target')
  })
})
