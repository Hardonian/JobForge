/**
 * Connector Runner (runConnector)
 *
 * Wraps any ConnectorFn with:
 * - Config validation (fail fast)
 * - Retry with exponential backoff
 * - Timeout enforcement
 * - Evidence packet emission (always, even on failure)
 * - Secret redaction
 */

import type { ZodIssue } from 'zod'
import {
  ConnectorConfigSchema,
  ConnectorInputSchema,
  ConnectorContextSchema,
  type ConnectorConfig,
  type ConnectorInput,
  type ConnectorContext,
  type ConnectorResult,
  type ConnectorFn,
  type RunConnectorParams,
} from './types.js'
import { EvidenceBuilder } from './evidence.js'

// ============================================================================
// Validation helpers
// ============================================================================

function validateConfig(config: unknown): ConnectorConfig {
  const result = ConnectorConfigSchema.safeParse(config)
  if (!result.success) {
    const issues = result.error.errors.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`)
    throw new ConnectorValidationError(
      `Invalid connector config: ${issues.join('; ')}`,
      'CONFIG_VALIDATION_ERROR',
      issues
    )
  }
  return result.data
}

function validateInput(input: unknown): ConnectorInput {
  const result = ConnectorInputSchema.safeParse(input)
  if (!result.success) {
    const issues = result.error.errors.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`)
    throw new ConnectorValidationError(
      `Invalid connector input: ${issues.join('; ')}`,
      'INPUT_VALIDATION_ERROR',
      issues
    )
  }
  return result.data
}

function validateContext(context: unknown): ConnectorContext {
  const result = ConnectorContextSchema.safeParse(context)
  if (!result.success) {
    const issues = result.error.errors.map((e: ZodIssue) => `${e.path.join('.')}: ${e.message}`)
    throw new ConnectorValidationError(
      `Invalid connector context: ${issues.join('; ')}`,
      'CONTEXT_VALIDATION_ERROR',
      issues
    )
  }
  return result.data
}

// ============================================================================
// Errors
// ============================================================================

export class ConnectorValidationError extends Error {
  public readonly code: string
  public readonly issues: string[]

  constructor(message: string, code: string, issues: string[]) {
    super(message)
    this.name = 'ConnectorValidationError'
    this.code = code
    this.issues = issues
  }
}

export class ConnectorTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Connector timed out after ${timeoutMs}ms`)
    this.name = 'ConnectorTimeoutError'
  }
}

// ============================================================================
// Retry logic
// ============================================================================

function computeBackoff(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  multiplier: number
): number {
  const delay = Math.min(baseDelay * Math.pow(multiplier, attempt), maxDelay)
  // Add jitter (10%)
  const jitter = delay * 0.1 * Math.random()
  return Math.round(delay + jitter)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// runConnector - the canonical entry point
// ============================================================================

/**
 * Execute a connector with full safety harness:
 * - Validates config, input, context (fail fast with actionable errors)
 * - Applies retry with exponential backoff
 * - Enforces timeout
 * - Always emits an evidence packet
 * - Never leaks secrets in evidence
 */
export async function runConnector(
  fn: ConnectorFn,
  params: RunConnectorParams
): Promise<ConnectorResult> {
  // 1. Validate all inputs strictly
  const config = validateConfig(params.config)
  const input = validateInput(params.input)
  const context = validateContext(params.context)

  // 2. Start evidence builder
  const evidence = new EvidenceBuilder({
    connector_id: config.connector_id,
    trace_id: context.trace_id,
    tenant_id: context.tenant_id,
    project_id: context.project_id,
    input: {
      ...input.payload,
      operation: input.operation,
      idempotency_key: input.idempotency_key,
      // Also include config settings (will be redacted)
      _config_settings: config.settings,
    },
  })

  const { max_retries, base_delay_ms, max_delay_ms, backoff_multiplier } = config.retry_policy

  let lastError: { code: string; message: string; retryable: boolean } | undefined
  let lastData: unknown

  // 3. Retry loop
  for (let attempt = 0; attempt <= max_retries; attempt++) {
    try {
      // Apply timeout
      const result = await Promise.race([
        fn({ config, input, context: { ...context, attempt_no: attempt + 1 } }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new ConnectorTimeoutError(config.timeout_ms)), config.timeout_ms)
        ),
      ])

      // Record any status codes from the result evidence
      if (result.evidence?.status_codes) {
        for (const code of result.evidence.status_codes) {
          evidence.recordStatusCode(code)
        }
      }

      if (result.ok) {
        // Success
        const packet = evidence.buildSuccess(result.data)
        return {
          ok: true,
          data: result.data,
          evidence: packet,
        }
      }

      // Connector returned ok=false
      lastError = result.error
        ? {
            code: result.error.code,
            message: result.error.message,
            retryable: result.error.retryable,
          }
        : { code: 'UNKNOWN', message: 'Connector returned ok=false', retryable: false }
      lastData = result.data

      // Check if error is retryable
      if (!lastError.retryable || attempt >= max_retries) {
        break
      }

      // Backoff and retry
      const delay = computeBackoff(attempt, base_delay_ms, max_delay_ms, backoff_multiplier)
      evidence.recordRetry(delay)
      await sleep(delay)
    } catch (err) {
      // Handle thrown errors
      const isTimeout = err instanceof ConnectorTimeoutError
      const message = err instanceof Error ? err.message : String(err)

      lastError = {
        code: isTimeout ? 'TIMEOUT' : 'CONNECTOR_ERROR',
        message,
        retryable: isTimeout || isTransientError(err),
      }

      if (isRateLimitError(err)) {
        evidence.recordRateLimit()
        lastError.code = 'RATE_LIMIT'
        lastError.retryable = true
      }

      if (!lastError.retryable || attempt >= max_retries) {
        break
      }

      const delay = computeBackoff(attempt, base_delay_ms, max_delay_ms, backoff_multiplier)
      evidence.recordRetry(delay)
      await sleep(delay)
    }
  }

  // All retries exhausted — build failure evidence
  const packet = evidence.buildFailure(
    lastError || { code: 'UNKNOWN', message: 'Unknown error', retryable: false },
    lastData
  )

  return {
    ok: false,
    data: lastData,
    error: lastError
      ? {
          code: lastError.code,
          message: lastError.message,
          retryable: lastError.retryable,
        }
      : { code: 'UNKNOWN', message: 'Unknown error', retryable: false },
    evidence: packet,
  }
}

// ============================================================================
// Error classification helpers
// ============================================================================

function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return (
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('etimedout') ||
      msg.includes('socket hang up') ||
      msg.includes('network') ||
      msg.includes('5xx') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    )
  }
  return false
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase()
    return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
  }
  return false
}
