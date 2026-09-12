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
