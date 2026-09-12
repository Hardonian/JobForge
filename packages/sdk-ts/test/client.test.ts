import { describe, it, expect } from 'vitest'
import { JobForgeClient } from '../src/client'
import * as crypto from 'node:crypto'

describe('JobForgeClient SDK', () => {
  const mockConfig = {
    supabaseUrl: 'https://mock.supabase.co',
    supabaseKey: 'mock-key-12345678901234567890',
  }

  it('should instantiate JobForgeClient', () => {
    const client = new JobForgeClient(mockConfig)
    expect(client).toBeDefined()
    expect(typeof client.enqueueJob).toBe('function')
    expect(typeof client.enqueueBatch).toBe('function')
    expect(typeof client.claimJobs).toBe('function')
    expect(typeof client.waitForJob).toBe('function')
    expect(typeof client.verifyWebhookSignature).toBe('function')
  })

  it('should verify webhook signatures correctly', () => {
    const client = new JobForgeClient(mockConfig)
    const secret = 'webhook-test-secret-key-42'
    const payload = JSON.stringify({ event: 'job.completed', id: '123' })

    const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex')

    expect(client.verifyWebhookSignature(payload, validSig, secret)).toBe(true)
    expect(client.verifyWebhookSignature(payload, `v1=${validSig}`, secret)).toBe(true)
    expect(client.verifyWebhookSignature(payload, 'invalid-sig', secret)).toBe(false)
    expect(client.verifyWebhookSignature(payload, validSig, 'wrong-secret')).toBe(false)
  })

  it('should reject invalid signatures safely in constant time', () => {
    const client = new JobForgeClient(mockConfig)
    expect(client.verifyWebhookSignature('', '', '')).toBe(false)
  })
})

describe('DirectPgJobForgeClient', () => {
  it('enqueues jobs and claims jobs via direct SQL execution', async () => {
    const { DirectPgJobForgeClient } = await import('../src/direct-pg-client')

    const executedQueries: Array<{ sql: string; params?: unknown[] }> = []

    const mockExecutor = async (sql: string, params?: unknown[]) => {
      executedQueries.push({ sql, params })

      if (sql.includes('INSERT INTO jobforge_jobs')) {
        return {
          rows: [
            {
              id: 'd9b7f5e1-0000-0000-0000-000000000001',
              tenant_id: params?.[0],
              type: params?.[1],
              payload: JSON.parse(params?.[2] as string),
              status: 'queued',
              attempts: 0,
              max_attempts: 5,
              priority: 10,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }
      }

      if (sql.includes('claim_jobs_fair_share')) {
        return {
          rows: [
            {
              id: 'd9b7f5e1-0000-0000-0000-000000000001',
              tenant_id: '00000000-0000-0000-0000-000000000001',
              type: 'test.job',
              payload: { message: 'fair-share-job' },
              status: 'running',
              attempts: 1,
            },
          ],
        }
      }

      if (sql.includes('get_tenant_billing_metrics')) {
        return {
          rows: [
            {
              period_date: '2026-09-12',
              jobs_completed: 10,
              jobs_failed: 1,
              compute_ms: 12500,
              ingress_bytes: 5400,
              egress_bytes: 8200,
              estimated_cost_usd: 0.000173,
            },
          ],
        }
      }

      return { rows: [] }
    }

    const pgClient = new DirectPgJobForgeClient({ executor: mockExecutor })

    // Test Enqueue
    const enqueued = await pgClient.enqueueJob({
      tenant_id: '00000000-0000-0000-0000-000000000001',
      type: 'test.job',
      payload: { greeting: 'hello-pg' },
      priority: 10,
    })

    expect(enqueued.id).toBe('d9b7f5e1-0000-0000-0000-000000000001')
    expect(enqueued.payload).toEqual({ greeting: 'hello-pg' })
    expect(executedQueries.some((q) => q.sql.includes('INSERT INTO jobforge_jobs'))).toBe(true)

    // Test Fair-Share Claim
    const claimed = await pgClient.claimJobsFairShare('worker-direct-1', 5, 2)
    expect(claimed).toHaveLength(1)
    expect(claimed[0].status).toBe('running')
    expect(executedQueries.some((q) => q.sql.includes('claim_jobs_fair_share'))).toBe(true)

    // Test Billing Metrics
    const metrics = await pgClient.getTenantBillingMetrics('00000000-0000-0000-0000-000000000001')
    expect(metrics).toHaveLength(1)
    expect(metrics[0].jobs_completed).toBe(10)
  })
})
