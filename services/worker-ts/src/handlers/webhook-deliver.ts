/**
 * Webhook Delivery Connector
 * Delivers webhooks with HMAC signing and retry tracking
 */

import type { JobContext } from '@jobforge/shared'
import { z } from 'zod'
import { createHmac } from 'crypto'
import { isIP } from 'net'
import { readBodyPreview } from './response-preview'

const WebhookDeliverPayloadSchema = z.object({
  target_url: z.string().url(),
  event_type: z.string().min(1),
  event_id: z.string().uuid(),
  data: z.record(z.unknown()),
  secret_ref: z.string().optional(),
  signature_algo: z.enum(['sha256', 'sha512']).default('sha256'),
  timeout_ms: z.number().int().positive().max(60_000).default(10_000),
})

export type WebhookDeliverPayload = z.infer<typeof WebhookDeliverPayloadSchema>

export interface WebhookDeliverResult {
  delivered: boolean
  status: number
  duration_ms: number
  response_preview: string
  signature: string | null
  timestamp: string
}

const PRIVATE_HOSTNAMES = new Set(['localhost'])

function isPrivateIpv4(hostname: string): boolean {
  const [a, b] = hostname.split('.').map((segment) => Number(segment))
  if ([a, b].some((value) => Number.isNaN(value))) {
    return false
  }
  if (a === 10 || a === 127 || a === 0) {
    return true
  }
  if (a === 169 && b === 254) {
    return true
  }
  if (a === 192 && b === 168) {
    return true
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true
  }
  return false
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  )
}

function assertSafeWebhookTarget(targetUrl: string): void {
  const url = new URL(targetUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported webhook protocol: ${url.protocol}`)
  }

  const hostname = url.hostname.toLowerCase()
  if (
    PRIVATE_HOSTNAMES.has(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw new Error(`Unsafe webhook target hostname: ${hostname}`)
  }

  const ipType = isIP(hostname)
  if (ipType === 4 && isPrivateIpv4(hostname)) {
    throw new Error(`Unsafe webhook target IP: ${hostname}`)
  }
  if (ipType === 6 && isPrivateIpv6(hostname)) {
    throw new Error(`Unsafe webhook target IP: ${hostname}`)
  }
}

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload: string, secret: string, algo: 'sha256' | 'sha512'): string {
  const hmac = createHmac(algo, secret)
  hmac.update(payload)
  return hmac.digest('hex')
}

/**
 * Webhook Delivery Handler
 */
export async function webhookDeliverHandler(
  payload: unknown,
  context: JobContext
): Promise<WebhookDeliverResult> {
  const validated = WebhookDeliverPayloadSchema.parse(payload)
  assertSafeWebhookTarget(validated.target_url)

  const timestamp = new Date().toISOString()

  // Prepare webhook payload
  const webhookPayload = {
    event_type: validated.event_type,
    event_id: validated.event_id,
    timestamp,
    data: validated.data,
  }

  const payloadString = JSON.stringify(webhookPayload)

  // Generate signature if secret provided
  let signature: string | null = null
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'JobForge-Webhook/1.0',
    'X-JobForge-Event': validated.event_type,
    'X-JobForge-Event-ID': validated.event_id,
    'X-JobForge-Timestamp': timestamp,
    'X-JobForge-Delivery-Attempt': String(context.attempt_no),
  }

  if (validated.secret_ref) {
    // In production, fetch secret from secure store using secret_ref
    // For now, read from env var with secret_ref as key
    const secret = process.env[validated.secret_ref]
    if (!secret) {
      throw new Error(`Secret not found: ${validated.secret_ref}`)
    }

    signature = generateSignature(payloadString, secret, validated.signature_algo)
    headers['X-JobForge-Signature'] = `${validated.signature_algo}=${signature}`
  }

  const startTime = Date.now()

  try {
    const response = await fetch(validated.target_url, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: AbortSignal.timeout(validated.timeout_ms),
    })

    const duration_ms = Date.now() - startTime

    const responsePreview = await readBodyPreview(response, 500)

    return {
      delivered: response.ok,
      status: response.status,
      duration_ms,
      response_preview: responsePreview.bodyPreview,
      signature,
      timestamp,
    }
  } catch (error) {
    const duration_ms = Date.now() - startTime

    // Return partial result for retryable errors
    return {
      delivered: false,
      status: 0,
      duration_ms,
      response_preview: error instanceof Error ? error.message : String(error),
      signature,
      timestamp,
    }
  }
}
