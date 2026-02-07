/**
 * Hello World Connector Tests
 */

import { describe, it, expect } from 'vitest'
import { runConnector } from '@jobforge/sdk'
import {
  helloWorldConnector,
  createHelloWorldConfig,
  createHelloWorldInput,
  createHelloWorldContext,
} from './index.js'

describe('Hello World Connector', () => {
  const config = createHelloWorldConfig()
  const context = createHelloWorldContext()

  it('returns a greeting with default message', async () => {
    const input = createHelloWorldInput()
    const result = await runConnector(helloWorldConnector, { config, input, context })

    expect(result.ok).toBe(true)
    expect(result.data).toEqual({
      message: 'Hello World!',
      echoed: true,
      delay_used: 0,
    })
    expect(result.evidence.ok).toBe(true)
    expect(result.evidence.connector_id).toBe('hello-world')
  })

  it('echos custom message', async () => {
    const input = createHelloWorldInput('Hi')
    const result = await runConnector(helloWorldConnector, { config, input, context })

    expect(result.ok).toBe(true)
    expect(result.data?.message).toBe('Hi World!')
  })

  it('respects echo=false', async () => {
    const input = createHelloWorldInput('Custom', { echo: false })
    const result = await runConnector(helloWorldConnector, { config, input, context })

    expect(result.ok).toBe(true)
    expect(result.data?.message).toBe('Hello World!')
  })

  it('handles delay correctly', async () => {
    const start = Date.now()
    const input = createHelloWorldInput('Test', { delay_ms: 100 })
    const result = await runConnector(helloWorldConnector, { config, input, context })
    const end = Date.now()

    expect(result.ok).toBe(true)
    expect(result.data?.delay_used).toBe(100)
    expect(end - start).toBeGreaterThanOrEqual(100)
  })

  it('validates input parameters', async () => {
    const invalidInput = createHelloWorldInput('')
    const result = await runConnector(helloWorldConnector, { config, input: invalidInput, context })

    expect(result.ok).toBe(false)
    expect(result.error?.code).toBe('VALIDATION_ERROR')
  })

  it('produces deterministic evidence', async () => {
    const input = createHelloWorldInput('Deterministic')
    const result1 = await runConnector(helloWorldConnector, { config, input, context })
    const result2 = await runConnector(helloWorldConnector, { config, input, context })

    expect(result1.evidence.output_hash).toBe(result2.evidence.output_hash)
    expect(result1.evidence.evidence_hash).toBe(result2.evidence.evidence_hash)
  })

  it('includes proper evidence metadata', async () => {
    const input = createHelloWorldInput()
    const result = await runConnector(helloWorldConnector, { config, input, context })

    expect(result.evidence.connector_id).toBe('hello-world')
    expect(result.evidence.trace_id).toBe(context.trace_id)
    expect(result.evidence.tenant_id).toBe(context.tenant_id)
    expect(result.evidence.started_at).toBeDefined()
    expect(result.evidence.ended_at).toBeDefined()
    expect(result.evidence.duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.evidence.retries).toBe(0)
    expect(result.evidence.ok).toBe(true)
  })
})
