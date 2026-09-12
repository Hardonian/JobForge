/**
 * JobForge shared types
 * Used by both TypeScript and Python SDKs
 */

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead' | 'canceled'

export interface JobRow {
  id: string
  tenant_id: string
  type: string
  payload: Record<string, unknown>
  status: JobStatus
  attempts: number
  max_attempts: number
  priority: number
  timeout_ms: number
  run_at: string // ISO timestamp
  locked_at: string | null
  locked_by: string | null
  heartbeat_at: string | null
  started_at: string | null
  finished_at: string | null
  idempotency_key: string | null
  created_by: string | null
  error: Record<string, unknown> | null
  result_id: string | null
  created_at: string
  updated_at: string
}

export interface TenantRow {
  id: string
  name: string
  slug: string
  tier: 'free' | 'standard' | 'pro' | 'enterprise'
  is_active: boolean
  is_paused: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ApiKeyRow {
  id: string
  tenant_id: string
  name: string
  key_prefix: string
  scopes: string[]
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface QuotaRow {
  tenant_id: string
  max_concurrent_jobs: number
  max_monthly_jobs: number
  max_payload_bytes: number
  burst_allowance: number
  updated_at: string
}

export interface EnqueueJobParams {
  tenant_id: string
  type: string
  payload: Record<string, unknown>
  idempotency_key?: string
  priority?: number
  timeout_ms?: number
  run_at?: string // ISO timestamp, defaults to now
  max_attempts?: number // defaults to 5
}

export interface BatchEnqueueJobItem {
  type: string
  payload: Record<string, unknown>
  idempotency_key?: string
  priority?: number
  timeout_ms?: number
  max_attempts?: number
  run_at?: string
}

export interface BatchEnqueueJobParams {
  tenant_id: string
  jobs: BatchEnqueueJobItem[]
}

export interface ReclaimStuckJobsResult {
  reclaimed_count: number
}

export interface BulkRescheduleDeadResult {
  rescheduled_count: number
}

export interface ClaimJobsParams {
  worker_id: string
  limit?: number
}

export interface HeartbeatJobParams {
  job_id: string
  worker_id: string
}

export interface CompleteJobParams {
  job_id: string
  worker_id: string
  status: 'succeeded' | 'failed'
  error?: Record<string, unknown>
  result?: Record<string, unknown>
  artifact_ref?: string
}

export interface CancelJobParams {
  job_id: string
  tenant_id: string
}

export interface RescheduleJobParams {
  job_id: string
  tenant_id: string
  run_at: string // ISO timestamp
}

export interface ListJobsParams {
  tenant_id: string
  filters?: {
    status?: JobStatus | JobStatus[]
    type?: string
    limit?: number
    offset?: number
  }
}

/**
 * Job type registry interface
 * Implement this to register job handlers with validation
 */
export interface JobTypeRegistry {
  register<TPayload = unknown, TResult = unknown>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    options?: JobHandlerOptions
  ): void

  get(type: string): JobHandlerRegistration | undefined
}

export interface JobHandler<TPayload = unknown, TResult = unknown> {
  (payload: TPayload, context: JobContext): Promise<TResult>
}

export interface JobContext {
  job_id: string
  tenant_id: string
  attempt_no: number
  trace_id: string
  heartbeat: () => Promise<void>
}

export interface JobHandlerOptions {
  validate?: (payload: unknown) => boolean
  maxAttempts?: number
  timeoutMs?: number
}

export interface JobHandlerRegistration {
  handler: JobHandler
  options?: JobHandlerOptions
}
