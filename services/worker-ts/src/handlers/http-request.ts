/**
 * HTTP Request Connector
 * Executes HTTP requests with SSRF protection
 */

import type { JobContext } from '@jobforge/shared'
import { z } from 'zod'
import { getAllowlistMatcher } from './allowlist-matcher'
import { collectResponseHeaders } from './response-headers'
import { readBodyPreview } from './response-preview'

const HttpRequestPayloadSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']).default('GET'),
  headers: z.record(z.string()).optional(),
  body: z.union([z.string(), z.record(z.unknown())]).optional(),
  timeout_ms: z.number().int().positive().max(300_000).default(30_000),
  allowlist: z.array(z.string()).optional(),
  redact_headers: z.array(z.string()).default(['authorization', 'cookie', 'set-cookie']),
  response_headers_allowlist: z.array(z.string()).optional(),
})

export type HttpRequestPayload = z.infer<typeof HttpRequestPayloadSchema>

export interface HttpRequestResult {
  status: number
  duration_ms: number
  response_headers: Record<string, string>
  response_body_preview: string
  success: boolean
}

const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
]

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  /^127\./,
  /^0\./,
]

/**
 * SSRF protection: validate URL against allowlist and block private IPs
 */
function validateUrl(url: string, allowlist?: string[]): void {
  const parsed = new URL(url)

  // Check blocked hosts
  if (BLOCKED_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error(`Blocked host: ${parsed.hostname}`)
  }

  // Check private IP ranges
  for (const pattern of PRIVATE_IP_RANGES) {
    if (pattern.test(parsed.hostname)) {
      throw new Error(`Private IP address not allowed: ${parsed.hostname}`)
    }
  }

  // Check allowlist if provided
  const matcher = getAllowlistMatcher(allowlist)
  if (matcher && !matcher(parsed.hostname.toLowerCase())) {
    throw new Error(`Host not in allowlist: ${parsed.hostname}`)
  }
}

/**
 * HTTP Request Handler
 */
export async function httpRequestHandler(
  payload: unknown,
  _context: JobContext
): Promise<HttpRequestResult> {
  const validated = HttpRequestPayloadSchema.parse(payload)

  // SSRF protection
  validateUrl(validated.url, validated.allowlist)

  const startTime = Date.now()

  try {
    const response = await fetch(validated.url, {
      method: validated.method,
      headers: validated.headers,
      body:
        validated.body && validated.method !== 'GET' && validated.method !== 'HEAD'
          ? typeof validated.body === 'string'
            ? validated.body
            : JSON.stringify(validated.body)
          : undefined,
      signal: AbortSignal.timeout(validated.timeout_ms),
    })

    const _duration_ms = Date.now() - startTime

    // Redact sensitive headers
    const response_headers = collectResponseHeaders(response, {
      redactHeaders: validated.redact_headers,
      allowlist: validated.response_headers_allowlist,
    })

    // Read response body with size limit
    const MAX_BODY_SIZE = 1_000_000 // 1MB
    const bodyPreview = await readBodyPreview(response, MAX_BODY_SIZE)

    return {
      status: response.status,
      duration_ms: _duration_ms,
      response_headers,
      response_body_preview: bodyPreview.bodyPreview,
      success: response.ok,
    }
  } catch (error) {
    const _duration_ms = Date.now() - startTime

    throw new Error(
      `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
