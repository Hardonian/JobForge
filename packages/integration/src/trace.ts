/**
 * Trace ID Propagation Utilities
 *
 * Provides consistent trace_id generation and propagation across:
 * - HTTP requests (headers)
 * - Background jobs (payload)
 * - Tool calls (context)
 *
 * All four apps (Settler, ReadyLayer, Keys, AIAS) use this convention.
 */

import { randomUUID } from 'crypto'

/**
 * HTTP Header name for trace propagation
 */
export const TRACE_ID_HEADER = 'x-trace-id'

/**
 * AsyncLocalStorage key for trace context (Node.js 14.8+)
 * Falls back to request-scoped storage
 */
export const TRACE_CONTEXT_KEY = 'jobforge_trace_context'

/**
 * Generate a new trace ID
 */
export function generateTraceId(): string {
  return randomUUID()
}

/**
 * Trace context for request/job/tool scoping
 */
export interface TraceContext {
  trace_id: string
  tenant_id: string
  project_id?: string
  actor_id?: string
  source_app: string
  started_at: string
}

/**
 * Create a new trace context
 */
export function createTraceContext(
  tenantId: string,
  sourceApp: string,
  projectId?: string,
  actorId?: string
): TraceContext {
  return {
    trace_id: generateTraceId(),
    tenant_id: tenantId,
    project_id: projectId,
    actor_id: actorId,
    source_app: sourceApp,
    started_at: new Date().toISOString(),
  }
}

/**
 * Extract trace ID from HTTP headers
 */
export function extractTraceFromHeaders(
  headers: Record<string, string | string[] | undefined>
): string | undefined {
  const header = headers[TRACE_ID_HEADER.toLowerCase()] || headers[TRACE_ID_HEADER]
  if (typeof header === 'string') {
    return header
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0]
  }
  return undefined
}

/**
 * HTTP headers with trace ID for outgoing requests
 */
export function createTraceHeaders(traceId: string): Record<string, string> {
  return {
    [TRACE_ID_HEADER]: traceId,
  }
}

/**
 * Propagate trace to job payload
 */
export function propagateTraceToJobPayload(
  payload: Record<string, unknown>,
  traceContext: TraceContext
): Record<string, unknown> {
  return {
    ...payload,
    _trace_context: {
      trace_id: traceContext.trace_id,
      tenant_id: traceContext.tenant_id,
      project_id: traceContext.project_id,
      actor_id: traceContext.actor_id,
      source_app: traceContext.source_app,
    },
  }
}

/**
 * Extract trace context from job payload
 */
export function extractTraceFromJobPayload(
  payload: Record<string, unknown>
): TraceContext | undefined {
  const traceContext = payload._trace_context as TraceContext | undefined
  if (traceContext && traceContext.trace_id) {
    return traceContext
  }
  return undefined
}

/**
 * Simple request-scoped storage for trace context
 * In production, use AsyncLocalStorage (Node.js 14.8+)
 */
class TraceContextStore {
  private storage = new Map<string, TraceContext>()

  set(traceId: string, context: TraceContext): void {
    this.storage.set(traceId, context)
  }

  get(traceId: string): TraceContext | undefined {
    return this.storage.get(traceId)
  }

  delete(traceId: string): void {
    this.storage.delete(traceId)
  }

  // Cleanup old contexts (call periodically)
  cleanup(maxAgeMs: number = 5 * 60 * 1000): void {
    const now = Date.now()
    for (const [traceId, context] of this.storage.entries()) {
      const age = now - new Date(context.started_at).getTime()
      if (age > maxAgeMs) {
        this.storage.delete(traceId)
      }
    }
  }
}

export const traceContextStore = new TraceContextStore()
