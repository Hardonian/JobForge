/**
 * JobForge Execution Plane - Event Envelope Types
 * Standard event format for runnerless autopilot modules
 */

export type {
  EventEnvelope,
  EventSubject,
  EventVersion,
  RedactionHints,
  SourceApp,
  SourceModule,
} from '@autopilot/contracts'

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
  schema_version?: string
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
