/**
 * HTTP Request Connector
 * Executes HTTP requests with SSRF protection including DNS-rebinding prevention
 */

import type { JobContext } from '@jobforge/shared'
import { z } from 'zod'
import { promises as dns } from 'node:dns'
import { isIP } from 'node:net'
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

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal', // GCP metadata
  'instance-data',
]

/**
 * Validates whether an IP address belongs to a private, loopback, or link-local range.
 */
export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip)
  if (!version) return true // Invalid IP considered unsafe

  if (version === 4) {
    const parts = ip.split('.').map((p) => parseInt(p, 10))
    if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
      return true
    }

    const [a, b] = parts

    // 0.0.0.0/8
    if (a === 0) return true
    // 10.0.0.0/8
    if (a === 10) return true
    // 127.0.0.0/8 (Loopback)
    if (a === 127) return true
    // 169.254.0.0/16 (Link-local / Cloud metadata)
    if (a === 169 && b === 254) return true
    // 172.16.0.0/12 (172.16.0.0 - 172.31.255.255)
    if (a === 172 && b >= 16 && b <= 31) return true
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (a === 100 && b >= 64 && b <= 127) return true
    // 224.0.0.0/4 (Multicast) or 240.0.0.0/4 (Reserved)
    if (a >= 224) return true

    return false
  }

  if (version === 6) {
    const lower = ip.toLowerCase()
    // Loopback ::1
    if (lower === '::1' || lower === '0:0:0:0:0:0:0:1') return true
    // Unspecified ::
    if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true
    // IPv4-mapped IPv6 (::ffff:x.x.x.x)
    if (lower.startsWith('::ffff:')) {
      const ipv4Part = lower.replace('::ffff:', '')
      if (isIP(ipv4Part) === 4) {
        return isPrivateIp(ipv4Part)
      }
      return true
    }
    // Unique local address fc00::/7 (fc00... or fd00...)
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    // Link-local fe80::/10
    if (
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb')
    ) {
      return true
    }

    return false
  }

  return true
}

/**
 * SSRF protection: validate URL against allowlist and resolve DNS to prevent DNS-rebinding
 */
export async function validateUrl(url: string, allowlist?: string[]): Promise<void> {
  const parsed = new URL(url)
  const hostname = parsed.hostname.toLowerCase()

  // Only allow http and https protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`)
  }

  // Check static blocked hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    throw new Error(`Blocked host: ${hostname}`)
  }

  // Check allowlist if provided
  const matcher = getAllowlistMatcher(allowlist)
  if (matcher && !matcher(hostname)) {
    throw new Error(`Host not in allowlist: ${hostname}`)
  }

  // If hostname is already a direct IP address
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error(`Private IP address not allowed: ${hostname}`)
    }
    return
  }

  // Resolve hostname via DNS to prevent DNS rebinding attacks
  try {
    const addresses = await dns.lookup(hostname, { all: true })
    if (!addresses || addresses.length === 0) {
      throw new Error(`DNS resolution returned no records for host: ${hostname}`)
    }

    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        throw new Error(
          `Host ${hostname} resolves to prohibited private IP address: ${record.address}`
        )
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('prohibited private IP address')) {
      throw err
    }
    throw new Error(
      `DNS resolution failed for host ${hostname}: ${err instanceof Error ? err.message : String(err)}`
    )
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

  // SSRF protection with DNS resolution check
  await validateUrl(validated.url, validated.allowlist)

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
    throw new Error(
      `HTTP request failed: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
