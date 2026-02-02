/**
 * MCP Server Audit Emitter
 * Emits audit logs for all MCP operations
 */

import { randomUUID } from 'crypto'
import type { McpAuditLogEntry, ActorContext, ToolContext, ToolResult } from '../types'
import { MCP_AUDIT_ENABLED } from '../feature-flags'

// ============================================================================
// Simple Redaction Helpers (to avoid import issues)
// ============================================================================

const REDACTION_PATTERNS = [
  /password/i,
  /secret/i,
  /token/i,
  /key/i,
  /credential/i,
  /auth/i,
  /api.?key/i,
  /private/i,
  /bearer/i,
]

function redactSecrets(text: string): string {
  let redacted = text
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(
      new RegExp(`(${pattern.source})[=:]\\s*[^\\s&]+`, 'gi'),
      '$1=***REDACTED***'
    )
  }
  redacted = redacted.replace(
    /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
    '***JWT_TOKEN_REDACTED***'
  )
  redacted = redacted.replace(
    /(?:sk-|pk-|bearer\s+)[a-zA-Z0-9_-]{20,}/gi,
    '***CREDENTIAL_REDACTED***'
  )
  return redacted
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const shouldRedact = REDACTION_PATTERNS.some((p) => p.test(key))
    if (shouldRedact) {
      result[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>)
    } else if (typeof value === 'string') {
      result[key] = redactSecrets(value)
    } else {
      result[key] = value
    }
  }
  return result
}

// ============================================================================
// Audit Buffer (In-Memory)
// ============================================================================

const auditBuffer: McpAuditLogEntry[] = []
const MAX_BUFFER_SIZE = 10000

/**
 * Emit audit log for a tool invocation
 */
export function emitToolAudit(
  context: ToolContext,
  result: ToolResult<unknown>,
  input: unknown,
  durationMs: number
): McpAuditLogEntry | null {
  if (!MCP_AUDIT_ENABLED) {
    return null
  }

  try {
    const entry: McpAuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      traceId: context.traceId,
      toolName: context.toolName,
      actorId: context.actor.actorId,
      tenantId: context.actor.tenantId,
      projectId: context.actor.projectId,
      decision: result.success ? 'allow' : result.error?.code === 'UNAUTHORIZED' ? 'deny' : 'error',
      reason: result.error?.message,
      durationMs,
      inputSummary: summarizeInput(input),
      outputSummary: result.success ? summarizeOutput(result.data) : undefined,
      errorSummary: result.error
        ? {
            code: result.error.code,
            message: redactSecrets(result.error.message),
          }
        : undefined,
      scopesChecked: context.actor.scopes,
    }

    auditBuffer.push(entry)
    if (auditBuffer.length > MAX_BUFFER_SIZE) {
      auditBuffer.shift()
    }

    return entry
  } catch (error) {
    console.error('Audit emission failed:', error)
    return null
  }
}

/**
 * Emit audit log for access denial
 */
export function emitDenialAudit(
  toolName: string,
  actor: ActorContext,
  traceId: string,
  reason: string,
  scopesRequired?: string[]
): McpAuditLogEntry | null {
  if (!MCP_AUDIT_ENABLED) {
    return null
  }

  try {
    const entry: McpAuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      traceId,
      toolName,
      actorId: actor.actorId,
      tenantId: actor.tenantId,
      projectId: actor.projectId,
      decision: 'deny',
      reason,
      durationMs: 0,
      scopesChecked: scopesRequired || actor.scopes,
    }

    auditBuffer.push(entry)
    if (auditBuffer.length > MAX_BUFFER_SIZE) {
      auditBuffer.shift()
    }

    return entry
  } catch {
    return null
  }
}

/**
 * Emit audit log for rate limit hit
 */
export function emitRateLimitAudit(
  toolName: string,
  actor: ActorContext,
  traceId: string
): McpAuditLogEntry | null {
  if (!MCP_AUDIT_ENABLED) {
    return null
  }

  try {
    const entry: McpAuditLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      traceId,
      toolName,
      actorId: actor.actorId,
      tenantId: actor.tenantId,
      projectId: actor.projectId,
      decision: 'deny',
      reason: 'Rate limit exceeded',
      durationMs: 0,
      scopesChecked: actor.scopes,
      rateLimitHit: true,
    }

    auditBuffer.push(entry)
    if (auditBuffer.length > MAX_BUFFER_SIZE) {
      auditBuffer.shift()
    }

    return entry
  } catch {
    return null
  }
}

// ============================================================================
// Summary Helpers
// ============================================================================

function summarizeInput(input: unknown): Record<string, unknown> {
  if (typeof input !== 'object' || input === null) {
    return { type: typeof input }
  }
  const redacted = redactObject(input as Record<string, unknown>)
  return createSummary(redacted, 2)
}

function summarizeOutput(output: unknown): Record<string, unknown> {
  if (typeof output !== 'object' || output === null) {
    return { type: typeof output }
  }
  const redacted = redactObject(output as Record<string, unknown>)
  return createSummary(redacted, 2)
}

function createSummary(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  if (depth <= 0) {
    return { '[truncated]': true }
  }

  const summary: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      summary[key] = value.length > 100 ? value.substring(0, 100) + '...' : value
    } else if (Array.isArray(value)) {
      summary[key] = { count: value.length, items: value.slice(0, 3) }
    } else if (typeof value === 'object' && value !== null) {
      summary[key] = createSummary(value as Record<string, unknown>, depth - 1)
    } else {
      summary[key] = value
    }
  }

  return summary
}

// ============================================================================
// Audit Query Functions
// ============================================================================

export function queryAuditLogs(
  tenantId: string,
  options: {
    from?: Date
    to?: Date
    toolName?: string
    limit?: number
  } = {}
): McpAuditLogEntry[] {
  const { from, to, toolName, limit = 100 } = options

  let results = auditBuffer.filter((log) => log.tenantId === tenantId)

  if (from) {
    results = results.filter((log) => new Date(log.timestamp) >= from)
  }
  if (to) {
    results = results.filter((log) => new Date(log.timestamp) <= to)
  }
  if (toolName) {
    results = results.filter((log) => log.toolName === toolName)
  }

  return results.slice(-limit)
}

export function getAllAuditLogs(): McpAuditLogEntry[] {
  return [...auditBuffer]
}

export function clearAuditLogs(): void {
  auditBuffer.length = 0
}
