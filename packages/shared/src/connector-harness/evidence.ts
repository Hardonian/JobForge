/**
 * Evidence Packet Builder
 *
 * Produces deterministic evidence packets for every connector invocation.
 * - Redacts secrets (denylist wins over allowlist)
 * - Hashes outputs with stable JSON canonicalization
 * - Records telemetry (start/end, retries, backoff, status codes)
 * - Computes deterministic evidenceHash
 */

import { createHash, randomUUID } from 'crypto'
import { canonicalizeJson } from '@autopilot/contracts'
import { SECRET_DENYLIST, type EvidencePacket } from './types.js'

// ============================================================================
// Redaction
// ============================================================================

/**
 * Redact fields from an object using denylist matching.
 * Denylist always wins — any field whose key (case-insensitive) contains
 * a denylist entry is replaced with '[REDACTED]'.
 */
export function redactFields(
  obj: Record<string, unknown>,
  options?: {
    denylist?: readonly string[]
    allowlist?: readonly string[]
    maxDepth?: number
  }
): Record<string, unknown> {
  const denylist = options?.denylist ?? SECRET_DENYLIST
  const allowlist = options?.allowlist
  const maxDepth = options?.maxDepth ?? 8

  function shouldRedact(key: string): boolean {
    const lower = key.toLowerCase()
    // Denylist always wins
    if (denylist.some((d) => lower.includes(d.toLowerCase()))) {
      return true
    }
    // If allowlist is provided, redact anything not in allowlist
    if (allowlist && !allowlist.some((a) => lower === a.toLowerCase())) {
      return true
    }
    return false
  }

  function redactDeep(value: unknown, depth: number): unknown {
    if (depth > maxDepth) return '[MAX_DEPTH]'
    if (value === null || value === undefined) return value
    if (typeof value !== 'object') return value

    if (Array.isArray(value)) {
      return value.map((item) => redactDeep(item, depth + 1))
    }

    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(record)) {
      if (shouldRedact(key)) {
        result[key] = '[REDACTED]'
      } else if (typeof val === 'object' && val !== null) {
        result[key] = redactDeep(val, depth + 1)
      } else {
        result[key] = val
      }
    }
    return result
  }

  return redactDeep(obj, 0) as Record<string, unknown>
}

// ============================================================================
// Hashing
// ============================================================================

/**
 * Compute a deterministic SHA-256 hash of any value
 * using stable JSON canonicalization.
 */
export function hashOutput(value: unknown): string {
  const canonical = canonicalizeJson(value)
  return createHash('sha256').update(canonical).digest('hex')
}

// ============================================================================
// Evidence Packet Builder
// ============================================================================

export interface EvidenceBuilderOptions {
  connector_id: string
  trace_id: string
  tenant_id: string
  project_id?: string
  input: Record<string, unknown>
  denylist?: readonly string[]
  allowlist?: readonly string[]
}

export class EvidenceBuilder {
  private connector_id: string
  private trace_id: string
  private tenant_id: string
  private project_id?: string
  private started_at: string
  private start_time: number
  private retries: number = 0
  private status_codes: number[] = []
  private backoff_delays_ms: number[] = []
  private rate_limited: boolean = false
  private redacted_input: Record<string, unknown>

  constructor(options: EvidenceBuilderOptions) {
    this.connector_id = options.connector_id
    this.trace_id = options.trace_id
    this.tenant_id = options.tenant_id
    this.project_id = options.project_id
    this.started_at = new Date().toISOString()
    this.start_time = Date.now()

    // Redact input immediately
    this.redacted_input = redactFields(options.input, {
      denylist: options.denylist,
      allowlist: options.allowlist,
    })
  }

  /** Record a retry attempt */
  recordRetry(delayMs: number): void {
    this.retries++
    this.backoff_delays_ms.push(delayMs)
  }

  /** Record an HTTP status code */
  recordStatusCode(code: number): void {
    this.status_codes.push(code)
  }

  /** Record that a rate limit was hit */
  recordRateLimit(): void {
    this.rate_limited = true
  }

  /** Build a success evidence packet */
  buildSuccess(data: unknown): EvidencePacket {
    return this.build(true, data)
  }

  /** Build a failure evidence packet */
  buildFailure(
    error: { code: string; message: string; retryable: boolean },
    partialData?: unknown
  ): EvidencePacket {
    return this.build(false, partialData ?? null, error)
  }

  /** Build the evidence packet */
  private build(
    ok: boolean,
    data: unknown,
    error?: { code: string; message: string; retryable: boolean }
  ): EvidencePacket {
    const ended_at = new Date().toISOString()
    const duration_ms = Date.now() - this.start_time
    const output_hash = hashOutput(data)
    const evidence_id = `ev-${randomUUID()}`

    // Build packet without evidence_hash first
    const packetBody = {
      evidence_id,
      connector_id: this.connector_id,
      trace_id: this.trace_id,
      started_at: this.started_at,
      ended_at,
      duration_ms,
      retries: this.retries,
      status_codes: this.status_codes,
      redacted_input: this.redacted_input,
      output_hash,
      ok,
      error: error || undefined,
      backoff_delays_ms: this.backoff_delays_ms,
      rate_limited: this.rate_limited,
      tenant_id: this.tenant_id,
      project_id: this.project_id,
    }

    // Compute deterministic evidence_hash over the body
    const evidence_hash = hashOutput(packetBody)

    return {
      ...packetBody,
      evidence_hash,
    }
  }
}

// ============================================================================
// Convenience: Check evidence for secret leakage
// ============================================================================

/**
 * Scan an evidence packet (serialized) for any secret-like values.
 * Returns an array of field paths where secrets were detected.
 */
export function scanForSecrets(
  obj: unknown,
  denylist: readonly string[] = SECRET_DENYLIST,
  path: string = ''
): string[] {
  const leaks: string[] = []
  if (obj === null || obj === undefined || typeof obj !== 'object') return leaks

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      leaks.push(...scanForSecrets(item, denylist, `${path}[${idx}]`))
    })
    return leaks
  }

  const record = obj as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    const fullPath = path ? `${path}.${key}` : key
    const lower = key.toLowerCase()

    // Check if key matches denylist AND value is NOT '[REDACTED]'
    const isDenied = denylist.some((d) => lower.includes(d.toLowerCase()))
    if (isDenied && typeof value === 'string' && value !== '[REDACTED]') {
      leaks.push(fullPath)
    }

    if (typeof value === 'object' && value !== null) {
      leaks.push(...scanForSecrets(value, denylist, fullPath))
    }
  }

  return leaks
}
