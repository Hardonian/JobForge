/**
 * @jobforge/client - Client types
 * Typed interfaces for the execution plane client
 */

import type {
  EventEnvelope,
  EventRow,
  ManifestRow,
  SourceApp,
  SourceModule,
  RedactionHints,
  EventVersion,
  ArtifactOutput,
} from '@jobforge/shared'

// Re-export shared types
export type {
  EventEnvelope,
  EventRow,
  ManifestRow,
  SourceApp,
  SourceModule,
  RedactionHints,
  EventVersion,
  ArtifactOutput,
}

/**
 * Client configuration options
 */
export interface JobForgeClientConfig {
  /** Supabase URL (required for direct transport) */
  supabaseUrl?: string
  /** Supabase service key (required for direct transport) */
  supabaseKey?: string
  /** HTTP API endpoint (alternative to direct transport) */
  apiEndpoint?: string
  /** API key for HTTP transport */
  apiKey?: string
  /** Default tenant ID */
  defaultTenantId?: string
  /** Enable dry run mode (no side effects) */
  dryRun?: boolean
}

/**
 * Parameters for submitting an event envelope
 */
export interface SubmitEventParams {
  /** Event envelope to submit */
  envelope: EventEnvelope
}

/**
 * Parameters for requesting a job
 */
export interface RequestJobParams {
  /** Job type/template key */
  jobType: string
  /** Job inputs */
  inputs: Record<string, unknown>
  /** Tenant ID */
  tenantId: string
  /** Project ID (optional) */
  projectId?: string
  /** Trace ID for distributed tracing */
  traceId: string
  /** Idempotency key (optional) */
  idempotencyKey?: string
  /** Actor ID (optional) */
  actorId?: string
  /** Source app */
  sourceApp: SourceApp
  /** Source module */
  sourceModule?: SourceModule
  /** Dry run mode */
  dryRun?: boolean
}

/**
 * Result from requesting a job
 */
export interface RequestJobResult {
  /** Created job/run ID */
  runId: string
  /** Job status */
  status: 'queued' | 'running' | 'completed' | 'failed'
  /** Trace ID */
  traceId: string
  /** Whether this was a dry run */
  dryRun: boolean
  /** Timestamp */
  timestamp: string
}

/**
 * Run status information
 */
export interface RunStatus {
  /** Run ID */
  runId: string
  /** Current status */
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  /** Progress percentage (0-100) */
  progress?: number
  /** Start time */
  startedAt?: string
  /** Completion time */
  completedAt?: string
  /** Error information (if failed) */
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

/**
 * Parameters for getting run status
 */
export interface GetRunStatusParams {
  /** Run ID to query */
  runId: string
  /** Tenant ID */
  tenantId: string
}

/**
 * Parameters for getting run manifest
 */
export interface GetRunManifestParams {
  /** Run ID to query */
  runId: string
  /** Tenant ID */
  tenantId: string
}

/**
 * Parameters for listing artifacts
 */
export interface ListArtifactsParams {
  /** Run ID to query */
  runId: string
  /** Tenant ID */
  tenantId: string
}

/**
 * Artifact list result
 */
export interface ListArtifactsResult {
  /** Run ID */
  runId: string
  /** List of artifacts */
  artifacts: ArtifactOutput[]
  /** Total count */
  totalCount: number
}

/**
 * Transport interface for different backends
 */
export interface Transport {
  /** Submit an event envelope */
  submitEvent(params: SubmitEventParams): Promise<EventRow>
  /** Request a job */
  requestJob(params: RequestJobParams): Promise<RequestJobResult>
  /** Get run status */
  getRunStatus(params: GetRunStatusParams): Promise<RunStatus>
  /** Get run manifest */
  getRunManifest(params: GetRunManifestParams): Promise<ManifestRow | null>
  /** List artifacts for a run */
  listArtifacts(params: ListArtifactsParams): Promise<ListArtifactsResult>
}

/**
 * Client error types
 */
export type ClientErrorCode =
  | 'INTEGRATION_DISABLED'
  | 'VALIDATION_ERROR'
  | 'TRANSPORT_ERROR'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

/**
 * Client error
 */
export class JobForgeClientError extends Error {
  constructor(
    public code: ClientErrorCode,
    message: string,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'JobForgeClientError'
  }
}
