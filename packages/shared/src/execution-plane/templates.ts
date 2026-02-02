/**
 * JobForge Execution Plane - Job Template Types
 * Registry for autopilot-style job templates
 */

export type TemplateCategory = 'ops' | 'support' | 'growth' | 'finops' | 'core'

export type CostTier = 'low' | 'medium' | 'high'

/**
 * JSON Schema placeholder (Zod-compatible structure)
 */
export interface JsonSchema {
  type: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
  [key: string]: unknown
}

/**
 * Job Template definition
 * Templates define autopilot job types that can be triggered
 */
export interface JobTemplate {
  /** Unique template key (e.g., 'autopilot.ops.scan') */
  template_key: string
  /** Human-readable name */
  name: string
  /** Description */
  description?: string
  /** Category/module */
  category: TemplateCategory
  /** Template version (semver) */
  version: string
  /** Input validation schema */
  input_schema: JsonSchema
  /** Output validation schema */
  output_schema: JsonSchema
  /** Required permission scopes */
  required_scopes: string[]
  /** Required connector types */
  required_connectors: string[]
  /** Estimated cost tier */
  estimated_cost_tier: CostTier
  /** Default max attempts */
  default_max_attempts: number
  /** Default timeout in milliseconds */
  default_timeout_ms: number
  /** Whether this is an action job (requires policy token) */
  is_action_job: boolean
  /** Whether template is enabled */
  enabled: boolean
  /** Creation timestamp */
  created_at: string
  /** Last update timestamp */
  updated_at: string
}

/**
 * Template row from database
 */
export interface TemplateRow {
  id: string
  template_key: string
  name: string
  description: string | null
  category: TemplateCategory
  version: string
  input_schema: JsonSchema
  output_schema: JsonSchema
  required_scopes: string[]
  required_connectors: string[]
  estimated_cost_tier: CostTier
  default_max_attempts: number
  default_timeout_ms: number
  is_action_job: boolean
  enabled: boolean
  created_at: string
  updated_at: string
}

/**
 * Parameters for requesting a job from a template
 */
export interface RequestJobParams {
  /** Tenant scope */
  tenant_id: string
  /** Template key to use */
  template_key: string
  /** Template inputs */
  inputs?: Record<string, unknown>
  /** Optional project scope */
  project_id?: string
  /** Trace ID for distributed tracing */
  trace_id?: string
  /** Actor ID */
  actor_id?: string
  /** Dry run mode (log only, don't execute) */
  dry_run?: boolean
}

/**
 * Response from job request
 */
export interface RequestJobResult {
  /** Created job row */
  job: Record<string, unknown>
  /** Trace ID */
  trace_id: string
  /** Audit log ID */
  audit_id: string
  /** Whether this was a dry run */
  dry_run?: boolean
}

/**
 * Autopilot job template keys (for type safety)
 */
export const AUTOPILOT_TEMPLATE_KEYS = {
  // Ops
  OPS_SCAN: 'autopilot.ops.scan',
  OPS_DIAGNOSE: 'autopilot.ops.diagnose',
  OPS_RECOMMEND: 'autopilot.ops.recommend',
  OPS_APPLY: 'autopilot.ops.apply',
  // Support
  SUPPORT_TRIAGE: 'autopilot.support.triage',
  SUPPORT_DRAFT_REPLY: 'autopilot.support.draft_reply',
  SUPPORT_PROPOSE_KB_PATCH: 'autopilot.support.propose_kb_patch',
  // Growth
  GROWTH_SEO_SCAN: 'autopilot.growth.seo_scan',
  GROWTH_EXPERIMENT_PROPOSE: 'autopilot.growth.experiment_propose',
  GROWTH_CONTENT_DRAFT: 'autopilot.growth.content_draft',
  // FinOps
  FINOPS_RECONCILE: 'autopilot.finops.reconcile',
  FINOPS_ANOMALY_SCAN: 'autopilot.finops.anomaly_scan',
  FINOPS_CHURN_RISK_REPORT: 'autopilot.finops.churn_risk_report',
} as const

export type AutopilotTemplateKey =
  (typeof AUTOPILOT_TEMPLATE_KEYS)[keyof typeof AUTOPILOT_TEMPLATE_KEYS]
