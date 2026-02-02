/**
 * JobForge Security Utilities
 * Security hardening for runnerless automation substrate
 * All new features are OFF by default via feature flags
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'

// ============================================================================
// Security Audit Types (separate from execution-plane audit)
// ============================================================================

export type SecurityAuditAction =
  | 'event_ingest'
  | 'job_request'
  | 'job_cancel'
  | 'policy_check_allow'
  | 'policy_check_deny'
  | 'trigger_fire'
  | 'rate_limit_hit'
  | 'replay_detected'

export interface SecurityAuditLogEntry {
  id: string
  timestamp: string
  tenantId: string
  projectId?: string
  actorId?: string
  action: SecurityAuditAction
  resource?: string
  resourceId?: string
  decision: 'allow' | 'deny' | 'error'
  reason?: string
  metadata?: Record<string, unknown>
}

// ============================================================================
// Security Constants
// ============================================================================

export const MAX_PAYLOAD_SIZE_BYTES = 1024 * 1024 // 1MB
export const MAX_PAYLOAD_DEPTH = 10
export const MAX_STRING_LENGTH = 100_000
export const MAX_ARRAY_LENGTH = 10_000
export const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
export const DEFAULT_RATE_LIMIT_MAX = 100 // requests per window
export const REPLAY_TTL_MS = 300_000 // 5 minutes
export const IDEMPOTENCY_KEY_TTL_MS = 86400000 // 24 hours

// ============================================================================
// Feature Flags (from feature-flags.ts to avoid circular deps)
// ============================================================================

function getEnvVar(name: string, defaultValue: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] ?? defaultValue
  }
  return defaultValue
}

function parseBool(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true'
}

const JOBFORGE_SECURITY_VALIDATION_ENABLED = parseBool(
  getEnvVar('JOBFORGE_SECURITY_VALIDATION_ENABLED', '1') // ON by default for safety
)

const JOBFORGE_RATE_LIMITING_ENABLED = parseBool(getEnvVar('JOBFORGE_RATE_LIMITING_ENABLED', '0'))

const JOBFORGE_AUDIT_LOGGING_ENABLED = parseBool(getEnvVar('JOBFORGE_AUDIT_LOGGING_ENABLED', '0'))

// ============================================================================
// Input Validation with Size/Depth Limits
// ============================================================================

export interface ValidationResult {
  valid: boolean
  errors: string[]
  sanitized?: unknown
}

/**
 * Validate payload size and structure
 * Enforces: size limits, depth limits, string length caps, array limits
 */
export function validatePayload(
  payload: unknown,
  options: {
    maxSizeBytes?: number
    maxDepth?: number
    maxStringLength?: number
    maxArrayLength?: number
  } = {}
): ValidationResult {
  if (!JOBFORGE_SECURITY_VALIDATION_ENABLED) {
    return { valid: true, errors: [] }
  }

  const errors: string[] = []
  const {
    maxSizeBytes = MAX_PAYLOAD_SIZE_BYTES,
    maxDepth = MAX_PAYLOAD_DEPTH,
    maxStringLength = MAX_STRING_LENGTH,
    maxArrayLength = MAX_ARRAY_LENGTH,
  } = options

  // Check JSON size
  try {
    const payloadStr = JSON.stringify(payload)
    if (payloadStr.length > maxSizeBytes) {
      errors.push(`Payload size ${payloadStr.length} exceeds maximum ${maxSizeBytes}`)
    }
  } catch {
    errors.push('Payload cannot be serialized to JSON')
    return { valid: false, errors }
  }

  // Check depth, string lengths, array lengths
  const depthCheck = checkDepth(payload, maxDepth, maxStringLength, maxArrayLength, 0)
  if (!depthCheck.valid) {
    errors.push(...depthCheck.errors)
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

function checkDepth(
  value: unknown,
  maxDepth: number,
  maxStringLength: number,
  maxArrayLength: number,
  currentDepth: number
): ValidationResult {
  if (currentDepth > maxDepth) {
    return { valid: false, errors: [`Object depth exceeds maximum ${maxDepth}`] }
  }

  if (typeof value === 'string') {
    if (value.length > maxStringLength) {
      return {
        valid: false,
        errors: [`String length ${value.length} exceeds maximum ${maxStringLength}`],
      }
    }
    return { valid: true, errors: [] }
  }

  if (Array.isArray(value)) {
    if (value.length > maxArrayLength) {
      return {
        valid: false,
        errors: [`Array length ${value.length} exceeds maximum ${maxArrayLength}`],
      }
    }
    const errors: string[] = []
    for (const item of value) {
      const check = checkDepth(item, maxDepth, maxStringLength, maxArrayLength, currentDepth + 1)
      if (!check.valid) {
        errors.push(...check.errors)
      }
    }
    return { valid: errors.length === 0, errors }
  }

  if (typeof value === 'object' && value !== null) {
    const errors: string[] = []
    for (const [key, val] of Object.entries(value)) {
      // Check key length
      if (key.length > maxStringLength) {
        errors.push(`Object key length ${key.length} exceeds maximum ${maxStringLength}`)
      }
      const check = checkDepth(val, maxDepth, maxStringLength, maxArrayLength, currentDepth + 1)
      if (!check.valid) {
        errors.push(...check.errors)
      }
    }
    return { valid: errors.length === 0, errors }
  }

  return { valid: true, errors: [] }
}

/**
 * Enhanced zod schema for job payload validation
 */
export const safeJobPayloadSchema = z.record(z.unknown()).refine(
  (val) => {
    const result = validatePayload(val)
    return result.valid
  },
  {
    message: `Payload validation failed: exceeds size ${MAX_PAYLOAD_SIZE_BYTES} bytes, depth ${MAX_PAYLOAD_DEPTH}, or string/array limits`,
  }
)

// ============================================================================
// Safe Error Serializer (strips stack/secrets by default)
// ============================================================================

export interface ErrorSerializationOptions {
  includeStack?: boolean
  includeMessage?: boolean
  redactFields?: string[]
}

const DEFAULT_SECRET_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
  /api.?key/i,
  /private/i,
  /passphrase/i,
]

/**
 * Safely serialize error for logging/responses
 * Stacks and secrets are redacted by default
 */
export function safeSerializeError(
  error: Error | unknown,
  options: ErrorSerializationOptions = {}
): Record<string, unknown> {
  const { includeStack = false, includeMessage = true, redactFields = [] } = options

  if (!(error instanceof Error)) {
    return {
      message: includeMessage ? String(error) : 'Error',
      type: typeof error,
    }
  }

  const result: Record<string, unknown> = {
    name: error.name,
    type: error.constructor.name,
  }

  if (includeMessage) {
    result.message = redactSecrets(error.message)
  }

  if (includeStack) {
    result.stack = redactSecrets(error.stack || '')
  }

  // Redact additional fields
  for (const field of redactFields) {
    if (field in error) {
      const value = (error as unknown as Record<string, unknown>)[field]
      result[field] = redactSecrets(String(value))
    }
  }

  return result
}

/**
 * Redact potential secrets from strings
 */
export function redactSecrets(text: string): string {
  let redacted = text

  // Redact patterns like: secret=abc123, apiKey: xyz, etc.
  for (const pattern of DEFAULT_SECRET_PATTERNS) {
    redacted = redacted.replace(
      new RegExp(`(${pattern.source})[=:]\\s*[^\\s&]+`, 'gi'),
      '$1=***REDACTED***'
    )
  }

  // Redact JWT-like tokens
  redacted = redacted.replace(
    /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    '***JWT_TOKEN_REDACTED***'
  )

  // Redact common credential formats
  redacted = redacted.replace(
    /(?:sk-|pk-|bearer\s+)[a-zA-Z0-9_-]{20,}/gi,
    '***CREDENTIAL_REDACTED***'
  )

  return redacted
}

// ============================================================================
// Redaction Pipeline for Logs/Events/Manifests
// ============================================================================

export interface RedactionOptions {
  redactFields?: string[]
  redactPatterns?: RegExp[]
  maxDepth?: number
}

/**
 * Deep redact sensitive fields from objects
 */
export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  options: RedactionOptions = {}
): T {
  const {
    redactFields = ['password', 'secret', 'token', 'key', 'credential', 'apiKey'],
    maxDepth = 10,
  } = options

  return redactDeep(obj, redactFields, maxDepth, 0) as T
}

function redactDeep(
  value: unknown,
  redactFields: string[],
  maxDepth: number,
  currentDepth: number
): unknown {
  if (currentDepth > maxDepth) {
    return '[MAX_DEPTH_REACHED]'
  }

  if (typeof value === 'string') {
    return redactSecrets(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, redactFields, maxDepth, currentDepth + 1))
  }

  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      const shouldRedact = redactFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase())
      )
      if (shouldRedact) {
        result[key] = '***REDACTED***'
      } else {
        result[key] = redactDeep(val, redactFields, maxDepth, currentDepth + 1)
      }
    }
    return result
  }

  return value
}

// ============================================================================
// Replay Protection (event_id/idempotency dedupe)
// ============================================================================

export interface ReplayProtectionOptions {
  ttlMs?: number
}

export interface ReplayCheckResult {
  isDuplicate: boolean
  eventId: string
  key: string
}

/**
 * In-memory dedupe store for replay protection
 * For production, replace with Redis or distributed cache
 */
class DedupeStore {
  private store = new Map<string, { timestamp: number; eventType: string }>()
  private lastCleanup = Date.now()
  private cleanupInterval = 60000 // 1 minute

  set(key: string, eventType: string, ttlMs: number): void {
    const now = Date.now()
    this.store.set(key, { timestamp: now, eventType })

    // Periodic cleanup
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup(ttlMs)
    }
  }

  has(key: string, ttlMs: number): boolean {
    const entry = this.store.get(key)
    if (!entry) return false

    const now = Date.now()
    if (now - entry.timestamp > ttlMs) {
      this.store.delete(key)
      return false
    }

    return true
  }

  private cleanup(ttlMs: number): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > ttlMs) {
        this.store.delete(key)
      }
    }
    this.lastCleanup = now
  }

  size(): number {
    return this.store.size
  }
}

// Singleton dedupe store (tenant-scoped keys)
const dedupeStore = new DedupeStore()

/**
 * Generate dedupe key for event
 */
export function generateDedupeKey(tenantId: string, eventId: string, eventType: string): string {
  // Stable hash of composite key
  const composite = `${tenantId}:${eventId}:${eventType}`
  return createHash('sha256').update(composite).digest('hex').slice(0, 32)
}

/**
 * Check for duplicate event (idempotency)
 * Returns true if duplicate, false if new
 */
export function checkDuplicateEvent(
  tenantId: string,
  eventId: string,
  eventType: string,
  options: ReplayProtectionOptions = {}
): ReplayCheckResult {
  const { ttlMs = REPLAY_TTL_MS } = options
  const key = generateDedupeKey(tenantId, eventId, eventType)
  const isDuplicate = dedupeStore.has(key, ttlMs)

  if (!isDuplicate) {
    dedupeStore.set(key, eventType, ttlMs)
  }

  return {
    isDuplicate,
    eventId,
    key,
  }
}

/**
 * Clear dedupe store (for testing)
 */
export function clearDedupeStore(): void {
  // @ts-expect-error - accessing private for test cleanup
  dedupeStore.store.clear()
}

// ============================================================================
// Per-Tenant + Per-Actor Rate Limiting
// ============================================================================

interface RateLimitEntry {
  count: number
  windowStart: number
}

class RateLimiter {
  private limits = new Map<string, RateLimitEntry>()
  private lastCleanup = Date.now()
  private cleanupInterval = 60000 // 1 minute

  check(
    scope: string, // tenant_id or tenant_id:actor_id
    maxRequests: number,
    windowMs: number
  ): { allowed: boolean; remaining: number; resetAt: number } {
    if (!JOBFORGE_RATE_LIMITING_ENABLED) {
      return { allowed: true, remaining: maxRequests, resetAt: Date.now() + windowMs }
    }

    const now = Date.now()
    const entry = this.limits.get(scope)

    // Cleanup periodically
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup(now, windowMs)
    }

    if (!entry || now - entry.windowStart > windowMs) {
      // New window
      this.limits.set(scope, { count: 1, windowStart: now })
      return {
        allowed: true,
        remaining: maxRequests - 1,
        resetAt: now + windowMs,
      }
    }

    // Existing window
    if (entry.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.windowStart + windowMs,
      }
    }

    entry.count++
    return {
      allowed: true,
      remaining: maxRequests - entry.count,
      resetAt: entry.windowStart + windowMs,
    }
  }

  private cleanup(now: number, windowMs: number): void {
    for (const [key, entry] of this.limits.entries()) {
      if (now - entry.windowStart > windowMs) {
        this.limits.delete(key)
      }
    }
    this.lastCleanup = now
  }

  get size(): number {
    return this.limits.size
  }
}

// Singleton rate limiter
const rateLimiter = new RateLimiter()

export interface RateLimitResult {
  allowed: boolean
  scope: string
  limit: number
  remaining: number
  resetAt: number
  reason?: string
}

/**
 * Check rate limit for tenant or tenant+actor
 */
export function checkRateLimit(
  tenantId: string,
  actorId: string | undefined,
  options: {
    maxRequests?: number
    windowMs?: number
    perActor?: boolean
  } = {}
): RateLimitResult {
  const {
    maxRequests = DEFAULT_RATE_LIMIT_MAX,
    windowMs = RATE_LIMIT_WINDOW_MS,
    perActor = false,
  } = options

  const scope = perActor && actorId ? `${tenantId}:${actorId}` : tenantId
  const result = rateLimiter.check(scope, maxRequests, windowMs)

  return {
    allowed: result.allowed,
    scope,
    limit: maxRequests,
    remaining: result.remaining,
    resetAt: result.resetAt,
    reason: result.allowed ? undefined : `Rate limit exceeded: ${maxRequests} per ${windowMs}ms`,
  }
}

/**
 * Clear rate limiter (for testing)
 */
export function clearRateLimiter(): void {
  // @ts-expect-error - accessing private for test cleanup
  rateLimiter.limits.clear()
}

// ============================================================================
// Scope Enforcement
// ============================================================================

export interface ScopeCheckOptions {
  requiredScopes: string[]
  grantedScopes: string[]
  resource?: string
  action?: string
}

export interface ScopeCheckResult {
  allowed: boolean
  verifiedScopes: string[]
  missingScopes: string[]
  reason?: string
}

/**
 * Enforce scope requirements
 */
export function checkScopes(options: ScopeCheckOptions): ScopeCheckResult {
  const { requiredScopes, grantedScopes, resource, action } = options

  const verifiedScopes: string[] = []
  const missingScopes: string[] = []

  for (const scope of requiredScopes) {
    // Exact match
    if (grantedScopes.includes(scope)) {
      verifiedScopes.push(scope)
      continue
    }

    // Wildcard match (e.g., "jobs:*" matches "jobs:read")
    const wildcardScopes = grantedScopes.filter((s) => s.endsWith(':*'))
    const resourceType = scope.split(':')[0]
    const hasWildcard = wildcardScopes.some((s) => s === `${resourceType}:*`)

    if (hasWildcard) {
      verifiedScopes.push(scope)
      continue
    }

    missingScopes.push(scope)
  }

  const allowed = missingScopes.length === 0

  return {
    allowed,
    verifiedScopes,
    missingScopes,
    reason: allowed
      ? undefined
      : `Missing scopes: ${missingScopes.join(', ')} for ${action || 'action'} on ${resource || 'resource'}`,
  }
}

// ============================================================================
// Audit Logging (tenant-scoped)
// ============================================================================

// Types re-exported from execution-plane/schemas

/**
 * In-memory audit log (for development)
 * Production: write to database/audit service
 */
class AuditLogBuffer {
  private logs: SecurityAuditLogEntry[] = []
  private maxSize = 10000

  push(entry: SecurityAuditLogEntry): void {
    if (!JOBFORGE_AUDIT_LOGGING_ENABLED) {
      return
    }

    this.logs.push(entry)

    // Trim if too large
    if (this.logs.length > this.maxSize) {
      this.logs = this.logs.slice(-this.maxSize)
    }
  }

  query(
    tenantId: string,
    options: {
      from?: Date
      to?: Date
      action?: SecurityAuditAction
      limit?: number
    } = {}
  ): SecurityAuditLogEntry[] {
    const { from, to, action, limit = 100 } = options

    let results = this.logs.filter((log) => log.tenantId === tenantId)

    if (from) {
      results = results.filter((log) => new Date(log.timestamp) >= from)
    }
    if (to) {
      results = results.filter((log) => new Date(log.timestamp) <= to)
    }
    if (action) {
      results = results.filter((log) => log.action === action)
    }

    return results.slice(-limit)
  }

  getAll(): SecurityAuditLogEntry[] {
    return [...this.logs]
  }

  clear(): void {
    this.logs = []
  }
}

// Singleton audit buffer
const auditBuffer = new AuditLogBuffer()

/**
 * Write audit log entry (tenant-scoped, redacted)
 */
export function writeAuditLog(
  entry: Omit<SecurityAuditLogEntry, 'id' | 'timestamp'>
): SecurityAuditLogEntry | null {
  if (!JOBFORGE_AUDIT_LOGGING_ENABLED) {
    return null
  }

  const fullEntry: SecurityAuditLogEntry = {
    ...entry,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    metadata: entry.metadata ? redactObject(entry.metadata) : undefined,
  }

  auditBuffer.push(fullEntry)
  return fullEntry
}

/**
 * Query audit logs for tenant
 */
export function queryAuditLogs(
  tenantId: string,
  options: {
    from?: Date
    to?: Date
    action?: SecurityAuditAction
    limit?: number
  } = {}
): SecurityAuditLogEntry[] {
  return auditBuffer.query(tenantId, options)
}

/**
 * Get all audit logs (admin only)
 */
export function getAllAuditLogs(): SecurityAuditLogEntry[] {
  return auditBuffer.getAll()
}

/**
 * Clear audit logs (for testing)
 */
export function clearAuditLogs(): void {
  auditBuffer.clear()
}

// ============================================================================
// Idempotency Key Validation
// ============================================================================

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string | undefined | null): {
  valid: boolean
  error?: string
} {
  if (key === undefined || key === null) {
    return { valid: true } // Optional
  }

  if (typeof key !== 'string') {
    return { valid: false, error: 'Idempotency key must be a string' }
  }

  if (key.length < 1 || key.length > 255) {
    return { valid: false, error: 'Idempotency key must be 1-255 characters' }
  }

  // Only allow alphanumeric, hyphens, underscores, dots, colons
  if (!/^[a-zA-Z0-9._:-]+$/.test(key)) {
    return {
      valid: false,
      error: 'Idempotency key can only contain alphanumeric, hyphens, underscores, dots, colons',
    }
  }

  return { valid: true }
}

// ============================================================================
// Threat Model Summary
// ============================================================================

/**
 * THREAT MODEL TABLE (JobForge Security)
 *
 * | Attack Surface        | Risk              | Mitigation                           | Where Implemented          |
 * |----------------------|-------------------|--------------------------------------|---------------------------|
 * | Event Ingestion       | Payload overflow  | Size limits (1MB), depth (10),       | validatePayload()         |
 * |                      |                   | string length (100K), array (10K)    | safeJobPayloadSchema      |
 * | Event Replay          | Duplicate events  | event_id dedupe, TTL window (5m)     | checkDuplicateEvent()     |
 * |                      |                   | keyed by (tenant_id, event_id, type) | DedupeStore               |
 * | Rate Limiting         | Resource exhaustion| Per-tenant (100 req/min default)     | checkRateLimit()          |
 * |                      |                   | Per-actor optional                   | RateLimiter               |
 * | Scope Enforcement     | Unauthorized ops  | Required scopes vs granted scopes    | checkScopes()             |
 * |                      |                   | Wildcard support (*:*)              | ScopeCheckResult          |
 * | Error Leakage         | Secret exposure   | Stack stripped by default            | safeSerializeError()      |
 * |                      |                   | Secret patterns redacted             | redactSecrets()           |
 * | Log/Manifest Leakage  | PII in logs       | Deep redaction pipeline              | redactObject()            |
 * |                      |                   | Field-based redaction                | DEFAULT_SECRET_PATTERNS   |
 * | Idempotency Abuse     | Key collision     | Key format validation                | validateIdempotencyKey()  |
 * | Audit Trail Gaps      | Missing evidence  | Tenant-scoped audit logging          | writeAuditLog()           |
 * |                      |                   | All allow/deny decisions logged      | AuditLogBuffer            |
 *
 * All features are gated by environment variables (default OFF for new features):
 * - JOBFORGE_SECURITY_VALIDATION_ENABLED=1 (ON by default for safety)
 * - JOBFORGE_RATE_LIMITING_ENABLED=0
 * - JOBFORGE_AUDIT_LOGGING_ENABLED=0
 * - JOBFORGE_EVENTS_ENABLED=0
 * - JOBFORGE_TRIGGERS_ENABLED=0
 * - JOBFORGE_AUTOPILOT_JOBS_ENABLED=0
 * - JOBFORGE_ACTION_JOBS_ENABLED=0
 */
