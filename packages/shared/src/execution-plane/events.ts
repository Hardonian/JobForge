/**
 * JobForge Execution Plane - Event Envelope Types
 * Standard event format for runnerless autopilot modules
 */

export type EventVersion = '1.0'

export type SourceApp = 'settler' | 'aias' | 'keys' | 'readylayer' | 'jobforge' | 'external'

export type SourceModule = 'ops' | 'support' | 'growth' | 'finops' | 'core'

/**
 * Standard Event Envelope
 * All runnerless modules emit events in this format
 */
export interface EventEnvelope {
  /** Event schema version */
  event_version: EventVersion
  /** Event type identifier (e.g., 'infrastructure.alert', 'support.ticket.created') */
  event_type: string
  /** Timestamp when event occurred */
  occurred_at: string // ISO timestamp
  /** Unique trace ID for distributed tracing */
  trace_id: string
  /** Optional actor identifier (user, service, etc.) */
  actor_id?: string
  /** Tenant scope */
  tenant_id: string
  /** Optional project scope within tenant */
  project_id?: string
  /** Source application */
  source_app: SourceApp
  /** Source autopilot module */
  source_module?: SourceModule
  /** Optional subject reference */
  subject?: EventSubject
  /** Event payload (schema depends on event_type) */
  payload: Record<string, unknown>
  /** Whether event contains PII */
  contains_pii: boolean
  /** Redaction hints for sensitive fields */
  redaction_hints?: RedactionHints
}

/**
 * Subject reference for entity-related events
 */
export interface EventSubject {
  type: string
  id: string
}

/**
 * Redaction hints for PII fields
 */
export interface RedactionHints {
  /** Fields to redact in logs */
  redact_fields?: string[]
  /** Fields to encrypt at rest */
  encrypt_fields?: string[]
  /** Data retention days */
  retention_days?: number
}

/**
 * Event row from database
 */
export interface EventRow {
  id: string
  tenant_id: string
  project_id: string | null
  event_version: string
  event_type: string
  occurred_at: string
  trace_id: string
  actor_id: string | null
  source_app: SourceApp
  source_module: SourceModule | null
  subject_type: string | null
  subject_id: string | null
  payload: Record<string, unknown>
  contains_pii: boolean
  redaction_hints: RedactionHints | null
  processed: boolean
  processed_at: string | null
  processing_job_id: string | null
  created_at: string
}

/**
 * Parameters for submitting an event
 */
export interface SubmitEventParams {
  tenant_id: string
  event_type: string
  trace_id: string
  source_app: SourceApp
  payload?: Record<string, unknown>
  project_id?: string
  actor_id?: string
  source_module?: SourceModule
  subject_type?: string
  subject_id?: string
  contains_pii?: boolean
  redaction_hints?: RedactionHints
  event_version?: EventVersion
}

/**
 * Parameters for querying events
 */
export interface ListEventsParams {
  tenant_id: string
  project_id?: string
  filters?: {
    event_type?: string
    source_app?: SourceApp
    processed?: boolean
    from_time?: string // ISO timestamp
    to_time?: string // ISO timestamp
    limit?: number
    offset?: number
  }
}
