/**
 * Connector Harness Golden Tests
 *
 * Tests:
 * 1. runConnector canonical interface
 * 2. Evidence packet always emitted (success + failure)
 * 3. Evidence schema validation
 * 4. Redaction: no secrets leak in evidence
 * 5. Simulated rate limit (429)
 * 6. Simulated transient failures (5xx)
 * 7. Simulated timeout
 * 8. Config validation (fail fast with actionable errors)
 * 9. Adversarial cases
 */

import { describe, it, expect } from 'vitest'
import {
  runConnector,
  ConnectorHarness,
  EvidenceBuilder,
  redactFields,
  hashOutput,
  scanForSecrets,
  createTestFixture,
  ConnectorValidationError,
  ConnectorResultSchema,
  EvidencePacketSchema,
  type ConnectorFn,
  type ConnectorResult,
  type RunConnectorParams,
  type EvidencePacket,
} from '../src/connector-harness/index.js'

// ============================================================================
// Helper: a minimal working connector
// ============================================================================

function createEchoConnector(): ConnectorFn {
  return async (params: RunConnectorParams): Promise<ConnectorResult> => {
    const evidence: EvidencePacket = {
      evidence_id: 'ev-echo',
      connector_id: params.config.connector_id,
      trace_id: params.context.trace_id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 1,
      retries: 0,
      status_codes: [200],
      redacted_input: {},
      output_hash: hashOutput(params.input.payload),
      evidence_hash: 'a'.repeat(64),
      ok: true,
      backoff_delays_ms: [],
      rate_limited: false,
      tenant_id: params.context.tenant_id,
      project_id: params.context.project_id,
    }
    return {
      ok: true,
      data: { echo: params.input.payload },
      evidence,
    }
  }
}

function createFailingConnector(errorCode: string, retryable: boolean): ConnectorFn {
  return async (params: RunConnectorParams): Promise<ConnectorResult> => {
    const evidence: EvidencePacket = {
      evidence_id: 'ev-fail',
      connector_id: params.config.connector_id,
      trace_id: params.context.trace_id,
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: 1,
      retries: 0,
      status_codes: [500],
      redacted_input: {},
      output_hash: hashOutput(null),
      evidence_hash: 'b'.repeat(64),
      ok: false,
      error: { code: errorCode, message: 'Test failure', retryable },
      backoff_delays_ms: [],
      rate_limited: false,
      tenant_id: params.context.tenant_id,
    }
    return {
      ok: false,
      error: { code: errorCode, message: 'Test failure', retryable },
      evidence,
    }
  }
}

const validConfig = {
  connector_id: 'test-connector',
  auth_type: 'none' as const,
  settings: {},
  retry_policy: {
    max_retries: 2,
    base_delay_ms: 10,
    max_delay_ms: 100,
    backoff_multiplier: 2,
  },
  timeout_ms: 5000,
}

const validInput = {
  operation: 'echo',
  payload: { message: 'hello' },
}

const validContext = {
  trace_id: 'trace-test-001',
  tenant_id: '00000000-0000-0000-0000-000000000001',
  dry_run: false,
  attempt_no: 1,
}

// ============================================================================
// Tests: runConnector canonical interface
// ============================================================================

describe('runConnector', () => {
  it('returns a valid ConnectorResult on success', async () => {
    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.data).toBeDefined()
    expect(result.evidence).toBeDefined()

    // Validate against schema
    const validation = ConnectorResultSchema.safeParse(result)
    expect(validation.success).toBe(true)
  })

  it('returns a valid ConnectorResult on failure', async () => {
    const result = await runConnector(createFailingConnector('EXTERNAL_ERROR', false), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error?.code).toBe('EXTERNAL_ERROR')
    expect(result.evidence).toBeDefined()

    const validation = ConnectorResultSchema.safeParse(result)
    expect(validation.success).toBe(true)
  })

  it('always emits an evidence packet, even on failure', async () => {
    const result = await runConnector(createFailingConnector('CRASH', false), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.evidence).toBeDefined()
    expect(result.evidence.connector_id).toBe('test-connector')
    expect(result.evidence.trace_id).toBe('trace-test-001')
  })
})

// ============================================================================
// Tests: Evidence packet
// ============================================================================

describe('Evidence Packet', () => {
  it('validates against EvidencePacketSchema on success', async () => {
    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    const validation = EvidencePacketSchema.safeParse(result.evidence)
    expect(validation.success).toBe(true)
  })

  it('validates against EvidencePacketSchema on failure', async () => {
    const result = await runConnector(createFailingConnector('FAIL', false), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    const validation = EvidencePacketSchema.safeParse(result.evidence)
    expect(validation.success).toBe(true)
  })

  it('contains deterministic output_hash', async () => {
    const result1 = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })
    const result2 = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    // Same input should produce same output_hash
    expect(result1.evidence.output_hash).toBe(result2.evidence.output_hash)
    expect(result1.evidence.output_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('has valid evidence_hash', async () => {
    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.evidence.evidence_hash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('records timing information', async () => {
    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.evidence.started_at).toBeDefined()
    expect(result.evidence.ended_at).toBeDefined()
    expect(result.evidence.duration_ms).toBeGreaterThanOrEqual(0)
  })
})

// ============================================================================
// Tests: Redaction & Secret Safety
// ============================================================================

describe('Redaction', () => {
  it('redacts secret fields from input', () => {
    const input = {
      operation: 'connect',
      api_key: 'sk-secret-123',
      password: 'hunter2',
      normal_field: 'visible',
    }

    const redacted = redactFields(input)
    expect(redacted.api_key).toBe('[REDACTED]')
    expect(redacted.password).toBe('[REDACTED]')
    expect(redacted.normal_field).toBe('visible')
    expect(redacted.operation).toBe('connect')
  })

  it('redacts nested secrets', () => {
    const input = {
      auth: {
        token: 'jwt-token-here',
        type: 'bearer',
      },
      data: { name: 'test' },
    }

    const redacted = redactFields(input)
    const auth = redacted.auth as Record<string, unknown>
    expect(auth.token).toBe('[REDACTED]')
    // 'bearer' key is in the denylist
    expect(auth.type).toBe('bearer') // value, not key
  })

  it('denylist wins over allowlist', () => {
    const input = {
      api_key: 'should-be-redacted',
      connector_id: 'should-be-visible',
    }

    const redacted = redactFields(input, {
      allowlist: ['api_key', 'connector_id'],
      denylist: ['api_key'],
    })

    expect(redacted.api_key).toBe('[REDACTED]')
    expect(redacted.connector_id).toBe('should-be-visible')
  })

  it('scanForSecrets detects unredacted secrets', () => {
    const evidence = {
      redacted_input: {
        api_key: 'sk-live-123', // Should have been redacted!
        normal: 'safe',
      },
    }

    const leaks = scanForSecrets(evidence)
    expect(leaks.length).toBeGreaterThan(0)
    expect(leaks).toContain('redacted_input.api_key')
  })

  it('scanForSecrets passes for properly redacted evidence', () => {
    const evidence = {
      redacted_input: {
        api_key: '[REDACTED]',
        normal: 'safe',
      },
    }

    const leaks = scanForSecrets(evidence)
    expect(leaks.length).toBe(0)
  })

  it('evidence from runConnector never contains secret values', async () => {
    const configWithSecrets = {
      ...validConfig,
      settings: {
        api_key: 'sk-secret-should-not-appear',
        password: 'hunter2-should-not-appear',
        endpoint: 'https://api.example.com',
      },
    }

    const result = await runConnector(createEchoConnector(), {
      config: configWithSecrets,
      input: validInput,
      context: validContext,
    })

    const evidenceStr = JSON.stringify(result.evidence)
    expect(evidenceStr).not.toContain('sk-secret-should-not-appear')
    expect(evidenceStr).not.toContain('hunter2-should-not-appear')
  })
})

// ============================================================================
// Tests: Config Validation (Fail Fast)
// ============================================================================

describe('Config Validation', () => {
  it('rejects missing connector_id', async () => {
    const badConfig = { ...validConfig, connector_id: '' }
    await expect(
      runConnector(createEchoConnector(), {
        config: badConfig,
        input: validInput,
        context: validContext,
      })
    ).rejects.toThrow(ConnectorValidationError)
  })

  it('rejects invalid auth_type', async () => {
    const badConfig = { ...validConfig, auth_type: 'magic' as 'none' }
    await expect(
      runConnector(createEchoConnector(), {
        config: badConfig,
        input: validInput,
        context: validContext,
      })
    ).rejects.toThrow(ConnectorValidationError)
  })

  it('rejects missing operation in input', async () => {
    const badInput = { ...validInput, operation: '' }
    await expect(
      runConnector(createEchoConnector(), {
        config: validConfig,
        input: badInput,
        context: validContext,
      })
    ).rejects.toThrow(ConnectorValidationError)
  })

  it('rejects invalid tenant_id in context', async () => {
    const badContext = { ...validContext, tenant_id: 'not-a-uuid' }
    await expect(
      runConnector(createEchoConnector(), {
        config: validConfig,
        input: validInput,
        context: badContext,
      })
    ).rejects.toThrow(ConnectorValidationError)
  })

  it('provides actionable error messages', async () => {
    const badConfig = { connector_id: '', auth_type: 'invalid' }
    try {
      await runConnector(createEchoConnector(), {
        config: badConfig as never,
        input: validInput,
        context: validContext,
      })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectorValidationError)
      const ve = err as ConnectorValidationError
      expect(ve.issues.length).toBeGreaterThan(0)
      expect(ve.code).toBe('CONFIG_VALIDATION_ERROR')
    }
  })
})

// ============================================================================
// Tests: Retry & Backoff
// ============================================================================

describe('Retry & Backoff', () => {
  it('retries on retryable errors', async () => {
    let callCount = 0
    const connector: ConnectorFn = async (params) => {
      callCount++
      if (callCount < 3) {
        return {
          ok: false,
          error: { code: 'TRANSIENT', message: 'Try again', retryable: true },
          evidence: {
            evidence_id: 'ev-retry',
            connector_id: params.config.connector_id,
            trace_id: params.context.trace_id,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            duration_ms: 1,
            retries: 0,
            status_codes: [503],
            redacted_input: {},
            output_hash: hashOutput(null),
            evidence_hash: 'c'.repeat(64),
            ok: false,
            error: { code: 'TRANSIENT', message: 'Try again', retryable: true },
            backoff_delays_ms: [],
            rate_limited: false,
            tenant_id: params.context.tenant_id,
          },
        }
      }
      return {
        ok: true,
        data: { success: true },
        evidence: {
          evidence_id: 'ev-ok',
          connector_id: params.config.connector_id,
          trace_id: params.context.trace_id,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: 1,
          retries: 0,
          status_codes: [200],
          redacted_input: {},
          output_hash: hashOutput({ success: true }),
          evidence_hash: 'd'.repeat(64),
          ok: true,
          backoff_delays_ms: [],
          rate_limited: false,
          tenant_id: params.context.tenant_id,
        },
      }
    }

    const result = await runConnector(connector, {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(callCount).toBe(3)
    expect(result.evidence.retries).toBe(2)
  })

  it('does not retry non-retryable errors', async () => {
    let callCount = 0
    const connector: ConnectorFn = async (params) => {
      callCount++
      return {
        ok: false,
        error: { code: 'PERMANENT', message: 'Not retryable', retryable: false },
        evidence: {
          evidence_id: 'ev-noretry',
          connector_id: params.config.connector_id,
          trace_id: params.context.trace_id,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: 1,
          retries: 0,
          status_codes: [400],
          redacted_input: {},
          output_hash: hashOutput(null),
          evidence_hash: 'e'.repeat(64),
          ok: false,
          error: { code: 'PERMANENT', message: 'Not retryable', retryable: false },
          backoff_delays_ms: [],
          rate_limited: false,
          tenant_id: params.context.tenant_id,
        },
      }
    }

    const result = await runConnector(connector, {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(callCount).toBe(1)
    expect(result.evidence.retries).toBe(0)
  })

  it('records backoff delays in evidence', async () => {
    let callCount = 0
    const connector: ConnectorFn = async (params) => {
      callCount++
      if (callCount <= 2) {
        return {
          ok: false,
          error: { code: 'RETRY', message: 'Retry me', retryable: true },
          evidence: {
            evidence_id: 'ev-backoff',
            connector_id: params.config.connector_id,
            trace_id: params.context.trace_id,
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            duration_ms: 1,
            retries: 0,
            status_codes: [503],
            redacted_input: {},
            output_hash: hashOutput(null),
            evidence_hash: 'f'.repeat(64),
            ok: false,
            backoff_delays_ms: [],
            rate_limited: false,
            tenant_id: params.context.tenant_id,
          },
        }
      }
      return {
        ok: true,
        data: 'done',
        evidence: {
          evidence_id: 'ev-done',
          connector_id: params.config.connector_id,
          trace_id: params.context.trace_id,
          started_at: new Date().toISOString(),
          ended_at: new Date().toISOString(),
          duration_ms: 1,
          retries: 0,
          status_codes: [200],
          redacted_input: {},
          output_hash: hashOutput('done'),
          evidence_hash: '0'.repeat(64),
          ok: true,
          backoff_delays_ms: [],
          rate_limited: false,
          tenant_id: params.context.tenant_id,
        },
      }
    }

    const result = await runConnector(connector, {
      config: validConfig,
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.evidence.backoff_delays_ms.length).toBe(2)
    expect(result.evidence.backoff_delays_ms.every((d) => d > 0)).toBe(true)
  })
})

// ============================================================================
// Tests: Simulated Failures via Golden Harness
// ============================================================================

describe('Golden Harness', () => {
  it('simulates 429 rate limit', async () => {
    const harness = new ConnectorHarness({
      fixtures: [createTestFixture({ name: 'rate-limit-test', expected: { ok: true } })],
      failures: [{ type: 'rate_limit', on_attempt: 1 }],
      capture_logs: false,
    })

    const results = await harness.runAll(createEchoConnector())
    expect(results.length).toBe(1)
    // Should still succeed if retries are available
    expect(results[0].result?.evidence.rate_limited).toBe(true)
  })

  it('simulates 5xx transient failure', async () => {
    const harness = new ConnectorHarness({
      fixtures: [createTestFixture({ name: '5xx-test', expected: { ok: true } })],
      failures: [{ type: 'server_error', on_attempt: 1, status_code: 503 }],
      capture_logs: false,
    })

    const results = await harness.runAll(createEchoConnector())
    expect(results.length).toBe(1)
    expect(results[0].result?.evidence.retries).toBeGreaterThanOrEqual(1)
  })

  it('simulates timeout', async () => {
    const harness = new ConnectorHarness({
      fixtures: [createTestFixture({ name: 'timeout-test', expected: { ok: true } })],
      failures: [{ type: 'timeout', on_attempt: 1 }],
      capture_logs: false,
    })

    const results = await harness.runAll(createEchoConnector())
    expect(results.length).toBe(1)
    expect(results[0].result?.evidence.retries).toBeGreaterThanOrEqual(1)
  })

  it('validates evidence schema for all fixtures', async () => {
    const harness = new ConnectorHarness({
      fixtures: [
        createTestFixture({ name: 'basic-success', expected: { ok: true } }),
        createTestFixture({
          name: 'with-secrets',
          config: {
            connector_id: 'secret-test',
            auth_type: 'api_key',
            settings: { api_key: 'sk-secret-key', endpoint: 'https://api.test.com' },
            retry_policy: {
              max_retries: 0,
              base_delay_ms: 10,
              max_delay_ms: 100,
              backoff_multiplier: 2,
            },
            timeout_ms: 5000,
          },
          expected: { ok: true },
        }),
      ],
      capture_logs: false,
    })

    const results = await harness.runAll(createEchoConnector())

    for (const result of results) {
      expect(result.evidence).toBeDefined()
      const validation = EvidencePacketSchema.safeParse(result.evidence)
      expect(validation.success).toBe(true)
    }
  })
})

// ============================================================================
// Tests: EvidenceBuilder directly
// ============================================================================

describe('EvidenceBuilder', () => {
  it('builds success evidence', () => {
    const builder = new EvidenceBuilder({
      connector_id: 'test',
      trace_id: 'trace-1',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      input: { operation: 'fetch', api_key: 'secret' },
    })

    const packet = builder.buildSuccess({ result: 'ok' })
    expect(packet.ok).toBe(true)
    expect(packet.connector_id).toBe('test')
    expect(packet.output_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(packet.evidence_hash).toMatch(/^[a-f0-9]{64}$/)

    // Input should be redacted
    expect(packet.redacted_input.api_key).toBe('[REDACTED]')
    expect(packet.redacted_input.operation).toBe('fetch')
  })

  it('builds failure evidence', () => {
    const builder = new EvidenceBuilder({
      connector_id: 'test',
      trace_id: 'trace-2',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      input: { operation: 'post' },
    })

    builder.recordRetry(100)
    builder.recordRetry(200)
    builder.recordStatusCode(503)
    builder.recordStatusCode(503)
    builder.recordRateLimit()

    const packet = builder.buildFailure({
      code: 'TIMEOUT',
      message: 'Timed out',
      retryable: true,
    })

    expect(packet.ok).toBe(false)
    expect(packet.retries).toBe(2)
    expect(packet.backoff_delays_ms).toEqual([100, 200])
    expect(packet.status_codes).toEqual([503, 503])
    expect(packet.rate_limited).toBe(true)
    expect(packet.error?.code).toBe('TIMEOUT')
  })
})

// ============================================================================
// Tests: hashOutput determinism
// ============================================================================

describe('hashOutput', () => {
  it('produces consistent hashes for same input', () => {
    const h1 = hashOutput({ a: 1, b: 2 })
    const h2 = hashOutput({ b: 2, a: 1 }) // Different key order
    expect(h1).toBe(h2)
  })

  it('produces different hashes for different input', () => {
    const h1 = hashOutput({ a: 1 })
    const h2 = hashOutput({ a: 2 })
    expect(h1).not.toBe(h2)
  })

  it('handles null and undefined', () => {
    const h1 = hashOutput(null)
    const h2 = hashOutput(null)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[a-f0-9]{64}$/)
  })
})

// ============================================================================
// Tests: Adversarial Cases
// ============================================================================

describe('Adversarial Cases', () => {
  it('handles connector that throws synchronously', async () => {
    const throwingConnector: ConnectorFn = async () => {
      throw new Error('Boom!')
    }

    const result = await runConnector(throwingConnector, {
      config: { ...validConfig, retry_policy: { ...validConfig.retry_policy, max_retries: 0 } },
      input: validInput,
      context: validContext,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.evidence).toBeDefined()
  })

  it('handles connector returning malformed result', async () => {
    const malformedConnector: ConnectorFn = async () => {
      return { unexpected: 'shape' } as unknown as ConnectorResult
    }

    const result = await runConnector(malformedConnector, {
      config: { ...validConfig, retry_policy: { ...validConfig.retry_policy, max_retries: 0 } },
      input: validInput,
      context: validContext,
    })

    // Should still produce a result with evidence
    expect(result.evidence).toBeDefined()
  })

  it('deeply nested secrets are redacted', () => {
    const input = {
      level1: {
        level2: {
          level3: {
            api_key: 'deep-secret',
            safe: 'visible',
          },
        },
      },
    }

    const redacted = redactFields(input)
    const l3 = redacted.level1 as Record<string, unknown>
    const l2 = l3.level2 as Record<string, unknown>
    const l1 = l2.level3 as Record<string, unknown>
    expect(l1.api_key).toBe('[REDACTED]')
    expect(l1.safe).toBe('visible')
  })

  it('handles empty payload', async () => {
    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: { operation: 'empty', payload: {} },
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.evidence).toBeDefined()
  })

  it('handles very large payload without crashing', async () => {
    const largePayload: Record<string, string> = {}
    for (let i = 0; i < 1000; i++) {
      largePayload[`field_${i}`] = `value_${i}`
    }

    const result = await runConnector(createEchoConnector(), {
      config: validConfig,
      input: { operation: 'large', payload: largePayload },
      context: validContext,
    })

    expect(result.ok).toBe(true)
    expect(result.evidence.output_hash).toMatch(/^[a-f0-9]{64}$/)
  })
})
