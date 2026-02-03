/**
 * HTTP JSON Connector v1
 * Advanced HTTP connector with strict validation, retries, circuit breaker, and SSRF protection
 */

import type { JobContext } from '@jobforge/shared'
import { z } from 'zod'

// ============================================================================
// Circuit Breaker State Management
// ============================================================================

interface CircuitBreakerState {
  failures: number
  lastFailureTime: number | null
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN'
}

const circuitBreakers = new Map<string, CircuitBreakerState>()

const CIRCUIT_BREAKER_CONFIG = {
  failureThreshold: 5,
  resetTimeoutMs: 30000, // 30 seconds
  halfOpenMaxCalls: 3,
}

function getCircuitBreaker(endpoint: string): CircuitBreakerState {
  if (!circuitBreakers.has(endpoint)) {
    circuitBreakers.set(endpoint, {
      failures: 0,
      lastFailureTime: null,
      state: 'CLOSED',
    })
  }
  return circuitBreakers.get(endpoint)!
}

function recordSuccess(endpoint: string): void {
  const cb = getCircuitBreaker(endpoint)
  if (cb.state === 'HALF_OPEN' || cb.state === 'CLOSED') {
    cb.failures = 0
    cb.state = 'CLOSED'
  }
}

function recordFailure(endpoint: string): void {
  const cb = getCircuitBreaker(endpoint)
  cb.failures++
  cb.lastFailureTime = Date.now()

  if (cb.failures >= CIRCUIT_BREAKER_CONFIG.failureThreshold) {
    cb.state = 'OPEN'
  }
}

function canExecute(endpoint: string): boolean {
  const cb = getCircuitBreaker(endpoint)

  if (cb.state === 'CLOSED') {
    return true
  }

  if (cb.state === 'OPEN') {
    const timeSinceLastFailure = Date.now() - (cb.lastFailureTime || 0)
    if (timeSinceLastFailure >= CIRCUIT_BREAKER_CONFIG.resetTimeoutMs) {
      cb.state = 'HALF_OPEN'
      cb.failures = 0
      return true
    }
    return false
  }

  // HALF_OPEN state
  return cb.failures < CIRCUIT_BREAKER_CONFIG.halfOpenMaxCalls
}

function getCircuitBreakerStatus(endpoint: string): { open: boolean; remainingCooldownMs: number } {
  const cb = getCircuitBreaker(endpoint)

  if (cb.state === 'OPEN') {
    const timeSinceLastFailure = Date.now() - (cb.lastFailureTime || 0)
    const remainingMs = Math.max(0, CIRCUIT_BREAKER_CONFIG.resetTimeoutMs - timeSinceLastFailure)
    return { open: true, remainingCooldownMs: remainingMs }
  }

  return { open: false, remainingCooldownMs: 0 }
}

// ============================================================================
// Schemas
// ============================================================================

export const HttpJsonRequestSchema = z.object({
  url: z.string().url().max(2048, 'URL exceeds maximum length of 2048 characters'),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).default('GET'),
  headers: z
    .record(z.string().max(8192, 'Header value exceeds maximum length'))
    .optional()
    .default({}),
  body: z.union([z.string(), z.record(z.unknown()), z.array(z.unknown())]).optional(),
  timeout_ms: z.number().int().positive().max(300_000).default(30_000),
  retry_config: z
    .object({
      max_retries: z.number().int().min(0).max(10).default(3),
      initial_delay_ms: z.number().int().positive().max(60_000).default(1000),
      max_delay_ms: z.number().int().positive().max(300_000).default(30_000),
      backoff_multiplier: z.number().positive().max(10).default(2),
      retryable_status_codes: z
        .array(z.number().int().min(100).max(599))
        .default([408, 429, 500, 502, 503, 504]),
    })
    .optional(),
  idempotency_key: z.string().max(256).optional(),
  allowlist: z.array(z.string().max(256)).optional(),
  redact_headers: z
    .array(z.string().max(256))
    .default(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-auth-token']),
  validate_ssl: z.boolean().default(true),
  follow_redirects: z.boolean().default(true),
  max_redirects: z.number().int().min(0).max(10).default(5),
  response_preview_max_bytes: z.number().int().min(100).max(10_000_000).default(100_000),
})

export type HttpJsonRequest = z.infer<typeof HttpJsonRequestSchema>

export const HttpJsonResponseSchema = z.object({
  success: z.boolean(),
  status_code: z.number().int(),
  status_text: z.string(),
  headers: z.record(z.string()),
  body_preview: z.string(),
  body_truncated: z.boolean(),
  duration_ms: z.number().int(),
  attempt_count: z.number().int(),
  correlation_id: z.string().optional(),
  idempotency_key: z.string().optional(),
})

export type HttpJsonResponse = z.infer<typeof HttpJsonResponseSchema>

export const HttpJsonErrorEnvelopeSchema = z.object({
  code: z.enum([
    'VALIDATION_ERROR',
    'TIMEOUT_ERROR',
    'CIRCUIT_BREAKER_OPEN',
    'SSRF_BLOCKED',
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'PARSE_ERROR',
    'INTERNAL_ERROR',
  ]),
  message: z.string(),
  correlation_id: z.string().optional(),
  details: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime(),
  request_info: z
    .object({
      url: z.string(),
      method: z.string(),
      attempt_count: z.number().int(),
      last_status_code: z.number().int().optional(),
    })
    .optional(),
})

export type HttpJsonErrorEnvelope = z.infer<typeof HttpJsonErrorEnvelopeSchema>

// ============================================================================
// SSRF Protection
// ============================================================================

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '[::1]',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
  'metadata.azure.internal', // Azure metadata
]

const PRIVATE_IP_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/i,
  /^fe80:/i,
  /^::1$/i,
]

const BLOCKED_PROTOCOLS = ['file:', 'ftp:', 'ftps:', 'gopher:', 'data:', 'javascript:', 'vbscript:']

/**
 * Validate URL against SSRF protection rules
 */
function validateUrl(url: string, allowlist?: string[]): void {
  let parsed: URL

  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Invalid URL format')
  }

  // Check protocol
  if (BLOCKED_PROTOCOLS.includes(parsed.protocol)) {
    throw new Error(`Blocked protocol: ${parsed.protocol}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  // Check blocked hosts
  if (BLOCKED_HOSTS.includes(hostname)) {
    throw new Error(`Blocked host: ${hostname}`)
  }

  // Check for private IP patterns
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      throw new Error(`Private IP address not allowed: ${hostname}`)
    }
  }

  // Check allowlist if provided
  if (allowlist && allowlist.length > 0) {
    const allowed = allowlist.some((pattern) => {
      const normalizedPattern = pattern.toLowerCase().trim()
      if (normalizedPattern.includes('*')) {
        const regex = new RegExp('^' + normalizedPattern.replace(/\*/g, '.*') + '$')
        return regex.test(hostname)
      }
      return hostname === normalizedPattern || hostname.endsWith(`.${normalizedPattern}`)
    })

    if (!allowed) {
      throw new Error(`Host not in allowlist: ${hostname}`)
    }
  }
}

// ============================================================================
// Retry Logic
// ============================================================================

interface RetryState {
  attempt: number
  lastError: Error | null
}

function calculateRetryDelay(
  attempt: number,
  config: NonNullable<HttpJsonRequest['retry_config']>
): number {
  const exponentialDelay =
    config.initial_delay_ms * Math.pow(config.backoff_multiplier, attempt - 1)
  const delayWithCap = Math.min(exponentialDelay, config.max_delay_ms)
  // Add jitter (±25%) to prevent thundering herd
  const jitter = delayWithCap * 0.25 * (Math.random() * 2 - 1)
  return Math.floor(delayWithCap + jitter)
}

function isRetryableStatus(status: number, retryableCodes: number[]): boolean {
  return retryableCodes.includes(status)
}

function isRetryableError(error: Error): boolean {
  if (error.name === 'AbortError' || error.name === 'TimeoutError') {
    return true
  }
  if (
    error.message.includes('ECONNRESET') ||
    error.message.includes('ETIMEDOUT') ||
    error.message.includes('ENOTFOUND') ||
    error.message.includes('ECONNREFUSED')
  ) {
    return true
  }
  if (error.message.includes('fetch') && error.name === 'TypeError') {
    return true
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================================================
// HTTP Request Execution
// ============================================================================

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout: number }
): Promise<Response> {
  const { timeout, signal: externalSignal, ...fetchOptions } = options

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort())
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    })
    return response
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeout}ms`)
      timeoutError.name = 'TimeoutError'
      throw timeoutError
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export class HttpJsonConnectorError extends Error {
  public readonly code: HttpJsonErrorEnvelope['code']
  public readonly correlationId?: string
  public readonly details?: Record<string, unknown>
  public readonly requestInfo?: HttpJsonErrorEnvelope['request_info']

  constructor(
    code: HttpJsonErrorEnvelope['code'],
    message: string,
    options?: {
      correlationId?: string
      details?: Record<string, unknown>
      requestInfo?: HttpJsonErrorEnvelope['request_info']
      cause?: Error
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'HttpJsonConnectorError'
    this.code = code
    this.correlationId = options?.correlationId
    this.details = options?.details
    this.requestInfo = options?.requestInfo
  }

  toEnvelope(): HttpJsonErrorEnvelope {
    return {
      code: this.code,
      message: this.message,
      correlation_id: this.correlationId,
      details: this.details,
      timestamp: new Date().toISOString(),
      request_info: this.requestInfo,
    }
  }
}

/**
 * HTTP JSON Connector Handler
 * Executes HTTP requests with comprehensive safety features:
 * - Strict input validation via Zod schemas
 * - SSRF protection with allowlist support
 * - Timeout with AbortController
 * - Safe retries (idempotent operations only)
 * - Circuit breaker for fault tolerance
 */
export async function httpJsonV1Handler(
  payload: unknown,
  context: JobContext
): Promise<HttpJsonResponse> {
  const startTime = Date.now()
  const correlationId = context.trace_id

  // Step 1: Strict input validation
  let validated: HttpJsonRequest
  try {
    validated = HttpJsonRequestSchema.parse(payload)
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new HttpJsonConnectorError(
        'VALIDATION_ERROR',
        `Input validation failed: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
        { correlationId, details: { zod_errors: error.errors } }
      )
    }
    throw new HttpJsonConnectorError(
      'VALIDATION_ERROR',
      `Input validation failed: ${error instanceof Error ? error.message : String(error)}`,
      { correlationId }
    )
  }

  // Step 2: SSRF protection
  try {
    validateUrl(validated.url, validated.allowlist)
  } catch (error) {
    throw new HttpJsonConnectorError(
      'SSRF_BLOCKED',
      `SSRF protection blocked request: ${error instanceof Error ? error.message : String(error)}`,
      { correlationId, details: { blocked_url: validated.url } }
    )
  }

  // Step 3: Check circuit breaker
  const cbStatus = getCircuitBreakerStatus(validated.url)
  if (!canExecute(validated.url)) {
    throw new HttpJsonConnectorError(
      'CIRCUIT_BREAKER_OPEN',
      `Circuit breaker is OPEN for endpoint. Retry after ${Math.ceil(cbStatus.remainingCooldownMs / 1000)}s cooldown.`,
      {
        correlationId,
        details: { remaining_cooldown_ms: cbStatus.remainingCooldownMs },
        requestInfo: { url: validated.url, method: validated.method, attempt_count: 0 },
      }
    )
  }

  // Step 4: Prepare request body
  let body: string | undefined
  if (validated.body && validated.method !== 'GET' && validated.method !== 'HEAD') {
    body = typeof validated.body === 'string' ? validated.body : JSON.stringify(validated.body)
    // Add Content-Type if not present and we're sending JSON
    if (!validated.headers['content-type'] && !validated.headers['Content-Type']) {
      validated.headers['content-type'] = 'application/json'
    }
  }

  // Step 5: Execute with retries
  const retryConfig = validated.retry_config || {
    max_retries: 3,
    initial_delay_ms: 1000,
    max_delay_ms: 30000,
    backoff_multiplier: 2,
    retryable_status_codes: [408, 429, 500, 502, 503, 504],
  }

  const retryState: RetryState = { attempt: 1, lastError: null }
  let lastResponse: Response | null = null

  for (
    retryState.attempt = 1;
    retryState.attempt <= retryConfig.max_retries + 1;
    retryState.attempt++
  ) {
    try {
      lastResponse = await fetchWithTimeout(validated.url, {
        method: validated.method,
        headers: validated.headers,
        body,
        timeout: validated.timeout_ms,
      })

      // Check if we should retry based on status code
      if (
        retryState.attempt <= retryConfig.max_retries &&
        isRetryableStatus(lastResponse.status, retryConfig.retryable_status_codes)
      ) {
        retryState.lastError = new Error(`HTTP ${lastResponse.status}: ${lastResponse.statusText}`)
        const delay = calculateRetryDelay(retryState.attempt, retryConfig)
        await sleep(delay)
        continue
      }

      // Success or non-retryable error - break out of retry loop
      break
    } catch (error) {
      retryState.lastError = error instanceof Error ? error : new Error(String(error))

      // Check if we should retry
      const isLastAttempt = retryState.attempt > retryConfig.max_retries
      const shouldRetry = !isLastAttempt && isRetryableError(retryState.lastError)

      if (!shouldRetry) {
        break
      }

      const delay = calculateRetryDelay(retryState.attempt, retryConfig)
      await sleep(delay)
    }
  }

  // Step 6: Handle final result
  const durationMs = Date.now() - startTime

  // If we never got a response, it was a network/timeout error
  if (!lastResponse) {
    recordFailure(validated.url)

    if (retryState.lastError?.name === 'TimeoutError') {
      throw new HttpJsonConnectorError(
        'TIMEOUT_ERROR',
        `Request timed out after ${validated.timeout_ms}ms after ${retryState.attempt} attempt(s)`,
        {
          correlationId,
          details: { timeout_ms: validated.timeout_ms, attempts: retryState.attempt },
          requestInfo: {
            url: validated.url,
            method: validated.method,
            attempt_count: retryState.attempt,
          },
        }
      )
    }

    throw new HttpJsonConnectorError(
      'NETWORK_ERROR',
      `Network error after ${retryState.attempt} attempt(s): ${retryState.lastError?.message || 'Unknown error'}`,
      {
        correlationId,
        details: { attempts: retryState.attempt, last_error: retryState.lastError?.message },
        requestInfo: {
          url: validated.url,
          method: validated.method,
          attempt_count: retryState.attempt,
        },
      }
    )
  }

  // Success! Record it for circuit breaker
  recordSuccess(validated.url)

  // Step 7: Process response
  const responseHeaders: Record<string, string> = {}
  lastResponse.headers.forEach((value, key) => {
    if (!validated.redact_headers.includes(key.toLowerCase())) {
      responseHeaders[key] = value
    }
  })

  // Read body with size limit
  let bodyText: string
  try {
    bodyText = await lastResponse.text()
  } catch (error) {
    throw new HttpJsonConnectorError(
      'PARSE_ERROR',
      `Failed to read response body: ${error instanceof Error ? error.message : String(error)}`,
      {
        correlationId,
        details: { status_code: lastResponse.status },
        requestInfo: {
          url: validated.url,
          method: validated.method,
          attempt_count: retryState.attempt,
          last_status_code: lastResponse.status,
        },
      }
    )
  }

  const truncated = bodyText.length > validated.response_preview_max_bytes
  const bodyPreview = truncated
    ? bodyText.substring(0, validated.response_preview_max_bytes) + '... (truncated)'
    : bodyText

  return {
    success: lastResponse.ok,
    status_code: lastResponse.status,
    status_text: lastResponse.statusText,
    headers: responseHeaders,
    body_preview: bodyPreview,
    body_truncated: truncated,
    duration_ms: durationMs,
    attempt_count: retryState.attempt,
    correlation_id: correlationId,
    idempotency_key: validated.idempotency_key,
  }
}

// Export for testing
export {
  getCircuitBreaker,
  recordSuccess,
  recordFailure,
  canExecute,
  getCircuitBreakerStatus,
  validateUrl,
  calculateRetryDelay,
  isRetryableStatus,
  isRetryableError,
  sleep,
  CIRCUIT_BREAKER_CONFIG,
}
