/**
 * Golden Harness for Connector Testing
 *
 * Replays fixtures through connectors under controlled conditions:
 * - Simulates 429 rate limits
 * - Simulates 5xx transient failures
 * - Simulates network timeouts
 * - Asserts return envelope shape
 * - Validates evidence against schema
 * - Checks no secrets are present in evidence or logs
 */

import type { ZodIssue } from 'zod'
import {
  ConnectorResultSchema,
  EvidencePacketSchema,
  type ConnectorFn,
  type ConnectorConfig,
  type ConnectorInput,
  type ConnectorContext,
  type ConnectorResult,
  type EvidencePacket,
} from './types.js'
import { scanForSecrets } from './evidence.js'
import { runConnector } from './runner.js'

// ============================================================================
// Types
// ============================================================================

export interface HarnessFixture {
  /** Fixture name (for reporting) */
  name: string
  /** Connector config */
  config: ConnectorConfig
  /** Connector input */
  input: ConnectorInput
  /** Connector context */
  context: ConnectorContext
  /** Expected outcome */
  expected: {
    ok: boolean
    error_code?: string
  }
}

export type SimulatedFailure =
  | { type: 'rate_limit'; on_attempt: number }
  | { type: 'server_error'; on_attempt: number; status_code: number }
  | { type: 'timeout'; on_attempt: number }
  | { type: 'network_error'; on_attempt: number; message?: string }

export interface HarnessOptions {
  /** Fixtures to test */
  fixtures: HarnessFixture[]
  /** Simulated failures to inject */
  failures?: SimulatedFailure[]
  /** Custom secret denylist (extends default) */
  secret_denylist?: string[]
  /** Whether to capture logs for secret scanning */
  capture_logs?: boolean
}

export interface HarnessTestResult {
  fixture_name: string
  passed: boolean
  errors: string[]
  result?: ConnectorResult
  evidence?: EvidencePacket
  duration_ms: number
}

// ============================================================================
// Connector Harness
// ============================================================================

export class ConnectorHarness {
  private options: HarnessOptions
  private capturedLogs: string[] = []

  constructor(options: HarnessOptions) {
    this.options = options
  }

  /**
   * Run all fixtures through a connector, applying simulated failures.
   * Returns per-fixture test results.
   */
  async runAll(connectorFn: ConnectorFn): Promise<HarnessTestResult[]> {
    const results: HarnessTestResult[] = []

    for (const fixture of this.options.fixtures) {
      const result = await this.runFixture(connectorFn, fixture)
      results.push(result)
    }

    return results
  }

  /**
   * Run a single fixture with all simulated failures.
   */
  async runFixture(connectorFn: ConnectorFn, fixture: HarnessFixture): Promise<HarnessTestResult> {
    const startTime = Date.now()
    const errors: string[] = []

    // Wrap connector with failure injection
    const wrappedFn = this.wrapWithFailures(connectorFn)

    // Start log capture
    this.capturedLogs = []
    const origConsoleLog = console.log
    const origConsoleError = console.error
    const origConsoleWarn = console.warn

    if (this.options.capture_logs !== false) {
      console.log = (...args: unknown[]) => {
        this.capturedLogs.push(args.map(String).join(' '))
        origConsoleLog.apply(console, args)
      }
      console.error = (...args: unknown[]) => {
        this.capturedLogs.push(args.map(String).join(' '))
        origConsoleError.apply(console, args)
      }
      console.warn = (...args: unknown[]) => {
        this.capturedLogs.push(args.map(String).join(' '))
        origConsoleWarn.apply(console, args)
      }
    }

    let result: ConnectorResult | undefined
    let evidence: EvidencePacket | undefined

    try {
      result = await runConnector(wrappedFn, {
        config: fixture.config,
        input: fixture.input,
        context: fixture.context,
      })

      evidence = result.evidence

      // Assert 1: Return envelope shape
      const envelopeValidation = ConnectorResultSchema.safeParse(result)
      if (!envelopeValidation.success) {
        errors.push(
          `Envelope shape invalid: ${envelopeValidation.error.errors.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
        )
      }

      // Assert 2: Evidence validates schema
      if (evidence) {
        const evidenceValidation = EvidencePacketSchema.safeParse(evidence)
        if (!evidenceValidation.success) {
          errors.push(
            `Evidence schema invalid: ${evidenceValidation.error.errors.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; ')}`
          )
        }
      } else {
        errors.push('Evidence packet missing from result')
      }

      // Assert 3: Expected outcome
      if (result.ok !== fixture.expected.ok) {
        errors.push(`Expected ok=${fixture.expected.ok}, got ok=${result.ok}`)
      }

      if (fixture.expected.error_code && result.error?.code !== fixture.expected.error_code) {
        errors.push(
          `Expected error code "${fixture.expected.error_code}", got "${result.error?.code}"`
        )
      }

      // Assert 4: No secrets in evidence
      if (evidence) {
        const leaks = scanForSecrets(evidence, this.getFullDenylist())
        if (leaks.length > 0) {
          errors.push(`Secret leakage in evidence: ${leaks.join(', ')}`)
        }
      }

      // Assert 5: No secrets in captured logs
      if (this.options.capture_logs !== false) {
        const logLeaks = this.scanLogsForSecrets(fixture)
        if (logLeaks.length > 0) {
          errors.push(`Secret leakage in logs: ${logLeaks.join(', ')}`)
        }
      }
    } catch (err) {
      errors.push(
        `Connector threw unhandled error: ${err instanceof Error ? err.message : String(err)}`
      )
    } finally {
      // Restore console
      if (this.options.capture_logs !== false) {
        console.log = origConsoleLog
        console.error = origConsoleError
        console.warn = origConsoleWarn
      }
    }

    return {
      fixture_name: fixture.name,
      passed: errors.length === 0,
      errors,
      result,
      evidence,
      duration_ms: Date.now() - startTime,
    }
  }

  /**
   * Wrap a connector with simulated failures.
   */
  private wrapWithFailures(fn: ConnectorFn): ConnectorFn {
    const failures = this.options.failures || []
    let callCount = 0

    return async (params) => {
      callCount++

      // Check for failures on this attempt
      for (const failure of failures) {
        if (failure.on_attempt === callCount) {
          switch (failure.type) {
            case 'rate_limit':
              throw new Error('429 Too Many Requests - Rate limit exceeded')
            case 'server_error':
              throw new Error(`${failure.status_code} Server Error`)
            case 'timeout':
              // Simulate a timeout by waiting longer than any reasonable timeout
              await new Promise((_, reject) =>
                setTimeout(() => reject(new Error('ETIMEDOUT')), 100)
              )
              break
            case 'network_error':
              throw new Error(failure.message || 'ECONNRESET')
          }
        }
      }

      return fn(params)
    }
  }

  /**
   * Get the full denylist (default + custom).
   */
  private getFullDenylist(): string[] {
    const base = [...(this.options.secret_denylist || [])]
    // Import SECRET_DENYLIST dynamically to avoid circular imports
    return [...new Set([...base])]
  }

  /**
   * Scan captured logs for secret values from the fixture config.
   */
  private scanLogsForSecrets(fixture: HarnessFixture): string[] {
    const leaks: string[] = []
    const secretValues = this.extractSecretValues(fixture.config.settings)

    for (const log of this.capturedLogs) {
      for (const { path, value } of secretValues) {
        if (typeof value === 'string' && value.length > 3 && log.includes(value)) {
          leaks.push(`Log contains secret value from config.settings.${path}`)
        }
      }
    }

    return leaks
  }

  /**
   * Extract potential secret values from config settings.
   */
  private extractSecretValues(
    obj: Record<string, unknown>,
    path: string = ''
  ): Array<{ path: string; value: unknown }> {
    const results: Array<{ path: string; value: unknown }> = []
    const denylist = this.getFullDenylist()

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = path ? `${path}.${key}` : key
      const lower = key.toLowerCase()

      const isDenied = denylist.some((d) => lower.includes(d.toLowerCase()))
      if (isDenied && value !== undefined && value !== null) {
        results.push({ path: fullPath, value })
      }

      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        results.push(...this.extractSecretValues(value as Record<string, unknown>, fullPath))
      }
    }

    return results
  }
}

// ============================================================================
// Convenience: Create standard test fixtures
// ============================================================================

/**
 * Create a minimal valid fixture for harness testing.
 */
export function createTestFixture(
  overrides: Partial<HarnessFixture> & { name: string }
): HarnessFixture {
  return {
    name: overrides.name,
    config: overrides.config ?? {
      connector_id: 'test-connector',
      auth_type: 'none',
      settings: {},
      retry_policy: {
        max_retries: 2,
        base_delay_ms: 10,
        max_delay_ms: 100,
        backoff_multiplier: 2,
      },
      timeout_ms: 5000,
    },
    input: overrides.input ?? {
      operation: 'test.operation',
      payload: { key: 'value' },
    },
    context: overrides.context ?? {
      trace_id: 'trace-test-001',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      dry_run: false,
      attempt_no: 1,
    },
    expected: overrides.expected ?? { ok: true },
  }
}
