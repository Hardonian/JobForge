/**
 * JobForge Execution Plane - Policy Token and Audit Types
 * Scope gating and audit logging for write actions
 */

/**
 * Policy token structure for write action authorization
 */
export interface PolicyToken {
  /** Token identifier */
  id: string
  /** Token version */
  version: string
  /** Issued at timestamp */
  issued_at: string
  /** Expires at timestamp */
  expires_at?: string
  /** Tenant scope */
  tenant_id: string
  /** Project scope (optional) */
  project_id?: string
  /** Actor who requested the token */
  actor_id: string
  /** Granted scopes */
  scopes: string[]
  /** Action being authorized */
  action: string
  /** Resource being modified */
  resource?: string
  /** Additional context */
  context?: Record<string, unknown>
  /** Token signature (HMAC or RSA) */
  signature: string
}

/**
 * Policy check result
 */
export interface PolicyCheckResult {
  /** Whether check passed */
  allowed: boolean
  /** Reason if denied */
  reason?: string
  /** Checked token ID */
  token_id?: string
  /** Scopes that were verified */
  verified_scopes: string[]
  /** Missing scopes if denied */
  missing_scopes?: string[]
}

/**
 * Parameters for policy token validation
 */
export interface ValidatePolicyTokenParams {
  /** Policy token string */
  token: string
  /** Required action */
  action: string
  /** Required scopes */
  required_scopes: string[]
  /** Tenant context */
  tenant_id: string
  /** Project context (optional) */
  project_id?: string
  /** Actor context (optional) */
  actor_id?: string
}

/**
 * Scope requirements for job types
 */
export interface ScopeRequirements {
  /** Required scopes for read operations */
  read: string[]
  /** Required scopes for write operations */
  write: string[]
  /** Required scopes for admin operations */
  admin: string[]
}

/**
 * Audit log entry
 */
export interface AuditLogEntry {
  id: string
  tenant_id: string
  project_id: string | null
  action: AuditAction
  actor_id: string | null
  event_id: string | null
  job_id: string | null
  template_key: string | null
  request_payload: Record<string, unknown> | null
  response_summary: Record<string, unknown> | null
  scopes_granted: string[] | null
  policy_token_used: string | null
  policy_check_result: boolean | null
  created_at: string
  processed_at: string | null
  duration_ms: number | null
}

/**
 * Audit action types
 */
export type AuditAction =
  | 'event_ingest'
  | 'job_request'
  | 'job_cancel'
  | 'policy_check'
  | 'trigger_fire'

/**
 * Parameters for creating audit log entry
 */
export interface CreateAuditLogParams {
  tenant_id: string
  action: AuditAction
  actor_id?: string
  project_id?: string
  event_id?: string
  job_id?: string
  template_key?: string
  request_payload?: Record<string, unknown>
  response_summary?: Record<string, unknown>
  scopes_granted?: string[]
  policy_token_used?: string
  policy_check_result?: boolean
  duration_ms?: number
}
