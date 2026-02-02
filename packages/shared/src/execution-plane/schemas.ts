/**
 * JobForge Execution Plane - Zod Schemas
 * Runtime validation for execution plane types
 */

import { z } from 'zod'

// ============================================================================
// Event Envelope Schemas
// ============================================================================

export const eventVersionSchema = z.enum(['1.0'])

export const sourceAppSchema = z.enum([
  'settler',
  'aias',
  'keys',
  'readylayer',
  'jobforge',
  'external',
])

export const sourceModuleSchema = z.enum(['ops', 'support', 'growth', 'finops', 'core'])

export const eventSubjectSchema = z.object({
  type: z.string(),
  id: z.string(),
})

export const redactionHintsSchema = z.object({
  redact_fields: z.array(z.string()).optional(),
  encrypt_fields: z.array(z.string()).optional(),
  retention_days: z.number().int().positive().optional(),
})

export const eventEnvelopeSchema = z.object({
  event_version: eventVersionSchema,
  event_type: z.string().min(1),
  occurred_at: z.string().datetime(),
  trace_id: z.string().min(1),
  actor_id: z.string().optional(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  source_app: sourceAppSchema,
  source_module: sourceModuleSchema.optional(),
  subject: eventSubjectSchema.optional(),
  payload: z.record(z.unknown()),
  contains_pii: z.boolean(),
  redaction_hints: redactionHintsSchema.optional(),
})

export const submitEventParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  event_type: z.string().min(1),
  trace_id: z.string().min(1),
  source_app: sourceAppSchema,
  payload: z.record(z.unknown()).default({}),
  project_id: z.string().uuid().optional(),
  actor_id: z.string().optional(),
  source_module: sourceModuleSchema.optional(),
  subject_type: z.string().optional(),
  subject_id: z.string().optional(),
  contains_pii: z.boolean().default(false),
  redaction_hints: redactionHintsSchema.optional(),
  event_version: eventVersionSchema.default('1.0'),
})

export const listEventsParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  filters: z
    .object({
      event_type: z.string().optional(),
      source_app: sourceAppSchema.optional(),
      processed: z.boolean().optional(),
      from_time: z.string().datetime().optional(),
      to_time: z.string().datetime().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
      offset: z.number().int().min(0).optional(),
    })
    .optional(),
})

// ============================================================================
// Artifact Manifest Schemas
// ============================================================================

export const manifestVersionSchema = z.enum(['1.0'])

export const manifestStatusSchema = z.enum(['pending', 'complete', 'failed'])

export const artifactOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  ref: z.string(),
  size: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  mime_type: z.string().optional(),
})

export const runMetricsSchema = z.record(z.number().positive().optional())

export const envFingerprintSchema = z.record(z.string().optional())

export const toolVersionsSchema = z.record(z.union([z.string(), z.record(z.string())]).optional())

export const artifactManifestSchema = z.object({
  manifest_version: manifestVersionSchema,
  run_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  job_type: z.string(),
  created_at: z.string().datetime(),
  inputs_snapshot_ref: z.string().optional(),
  logs_ref: z.string().optional(),
  outputs: z.array(artifactOutputSchema),
  metrics: runMetricsSchema,
  env_fingerprint: envFingerprintSchema,
  tool_versions: toolVersionsSchema,
  status: manifestStatusSchema,
  error: z.record(z.unknown()).optional(),
})

export const createManifestParamsSchema = z.object({
  run_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  job_type: z.string(),
  project_id: z.string().uuid().optional(),
  inputs_snapshot_ref: z.string().optional(),
  logs_ref: z.string().optional(),
  outputs: z.array(artifactOutputSchema).default([]),
  metrics: runMetricsSchema.default({}),
  env_fingerprint: envFingerprintSchema.default({}),
  tool_versions: toolVersionsSchema.default({}),
})

export const getManifestParamsSchema = z.object({
  run_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
})

// ============================================================================
// Job Template Schemas
// ============================================================================

export const templateCategorySchema = z.enum(['ops', 'support', 'growth', 'finops', 'core'])

export const costTierSchema = z.enum(['low', 'medium', 'high'])

export const jsonSchema = z.object({
  type: z.string(),
  properties: z.record(z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  additionalProperties: z.boolean().optional(),
})

export const jobTemplateSchema = z.object({
  template_key: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: templateCategorySchema,
  version: z.string(),
  input_schema: jsonSchema,
  output_schema: jsonSchema,
  required_scopes: z.array(z.string()),
  required_connectors: z.array(z.string()),
  estimated_cost_tier: costTierSchema,
  default_max_attempts: z.number().int().min(1).max(10),
  default_timeout_ms: z.number().int().positive(),
  is_action_job: z.boolean(),
  enabled: z.boolean(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export const requestJobParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  template_key: z.string(),
  inputs: z.record(z.unknown()).default({}),
  project_id: z.string().uuid().optional(),
  trace_id: z.string().optional(),
  actor_id: z.string().optional(),
  dry_run: z.boolean().default(false),
})

// ============================================================================
// Policy and Audit Schemas
// ============================================================================

export const policyTokenSchema = z.object({
  id: z.string(),
  version: z.string(),
  issued_at: z.string().datetime(),
  expires_at: z.string().datetime().optional(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  actor_id: z.string(),
  scopes: z.array(z.string()),
  action: z.string(),
  resource: z.string().optional(),
  context: z.record(z.unknown()).optional(),
  signature: z.string(),
})

export const policyCheckResultSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().optional(),
  token_id: z.string().optional(),
  verified_scopes: z.array(z.string()),
  missing_scopes: z.array(z.string()).optional(),
})

export const validatePolicyTokenParamsSchema = z.object({
  token: z.string(),
  action: z.string(),
  required_scopes: z.array(z.string()),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  actor_id: z.string().optional(),
})

export const auditActionSchema = z.enum([
  'event_ingest',
  'job_request',
  'job_cancel',
  'policy_check',
  'trigger_fire',
])

export const auditLogEntrySchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  action: auditActionSchema,
  actor_id: z.string().nullable(),
  event_id: z.string().uuid().nullable(),
  job_id: z.string().uuid().nullable(),
  template_key: z.string().nullable(),
  request_payload: z.record(z.unknown()).nullable(),
  response_summary: z.record(z.unknown()).nullable(),
  scopes_granted: z.array(z.string()).nullable(),
  policy_token_used: z.string().nullable(),
  policy_check_result: z.boolean().nullable(),
  created_at: z.string().datetime(),
  processed_at: z.string().datetime().nullable(),
  duration_ms: z.number().int().nullable(),
})

export const createAuditLogParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  action: auditActionSchema,
  actor_id: z.string().optional(),
  project_id: z.string().uuid().optional(),
  event_id: z.string().uuid().optional(),
  job_id: z.string().uuid().optional(),
  template_key: z.string().optional(),
  request_payload: z.record(z.unknown()).optional(),
  response_summary: z.record(z.unknown()).optional(),
  scopes_granted: z.array(z.string()).optional(),
  policy_token_used: z.string().optional(),
  policy_check_result: z.boolean().optional(),
  duration_ms: z.number().int().optional(),
})

// ============================================================================
// Trigger Schemas
// ============================================================================

export const triggerTypeSchema = z.enum(['cron', 'event'])

export const triggerSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  trigger_type: triggerTypeSchema,
  name: z.string(),
  cron_expression: z.string().nullable(),
  event_type_filter: z.string().nullable(),
  event_source_filter: z.string().nullable(),
  target_template_key: z.string(),
  target_inputs: z.record(z.unknown()),
  enabled: z.boolean(),
  dry_run: z.boolean(),
  last_fired_at: z.string().datetime().nullable(),
  last_job_id: z.string().uuid().nullable(),
  fire_count: z.number().int().min(0),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
})

export const createCronTriggerParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string(),
  cron_expression: z.string(),
  target_template_key: z.string(),
  target_inputs: z.record(z.unknown()).default({}),
  project_id: z.string().uuid().optional(),
  enabled: z.boolean().default(false),
  dry_run: z.boolean().default(false),
})

export const createEventTriggerParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string(),
  event_type_filter: z.string(),
  target_template_key: z.string(),
  target_inputs: z.record(z.unknown()).default({}),
  event_source_filter: z.string().optional(),
  project_id: z.string().uuid().optional(),
  enabled: z.boolean().default(false),
  dry_run: z.boolean().default(false),
})

// ============================================================================
// Bundle Trigger Rule Schemas
// ============================================================================

export const bundleSourceSchema = z.enum(['inline', 'artifact_ref'])

export const bundleTriggerMatchSchema = z.object({
  event_type_allowlist: z.array(z.string()).min(1),
  source_module_allowlist: z.array(z.string()).optional(),
  severity_threshold: z.string().optional(),
  priority_threshold: z.string().optional(),
})

export const bundleTriggerActionSchema = z.object({
  bundle_source: bundleSourceSchema,
  bundle_ref: z.string().optional(),
  bundle_builder: z.string().optional(),
  mode: z.enum(['dry_run', 'execute']).default('dry_run'),
})

export const bundleTriggerSafetySchema = z.object({
  cooldown_seconds: z.number().int().min(0).default(60),
  max_runs_per_hour: z.number().int().min(1).default(10),
  dedupe_key_template: z.string().optional(),
  allow_action_jobs: z.boolean().default(false),
})

export const bundleTriggerRuleSchema = z.object({
  rule_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().nullable(),
  name: z.string(),
  enabled: z.boolean().default(false),
  match: bundleTriggerMatchSchema,
  action: bundleTriggerActionSchema,
  safety: bundleTriggerSafetySchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_fired_at: z.string().datetime().nullable(),
  fire_count: z.number().int().min(0).default(0),
})

export const createBundleTriggerRuleParamsSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  name: z.string(),
  enabled: z.boolean().default(false),
  match: bundleTriggerMatchSchema,
  action: bundleTriggerActionSchema,
  safety: bundleTriggerSafetySchema.optional(),
})

export const triggerEvaluationResultSchema = z.object({
  rule_id: z.string().uuid(),
  event_id: z.string(),
  evaluated_at: z.string().datetime(),
  matched: z.boolean(),
  decision: z.enum(['fire', 'skip', 'rate_limited', 'cooldown', 'disabled', 'error']),
  reason: z.string(),
  bundle_run_id: z.string().optional(),
  dry_run: z.boolean(),
  safety_checks: z.object({
    cooldown_passed: z.boolean(),
    rate_limit_passed: z.boolean(),
    dedupe_passed: z.boolean(),
  }),
})

// ============================================================================
// Job Request Bundle Schemas (from @autopilot/contracts)
// ============================================================================

export const JobRequestSchema = z.object({
  id: z.string().min(1),
  job_type: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  payload: z.record(z.unknown()),
  idempotency_key: z.string().optional(),
  required_scopes: z.array(z.string()).default([]),
  is_action_job: z.boolean().default(false),
})

export type JobRequest = z.infer<typeof JobRequestSchema>

export const JobRequestBundleSchema = z.object({
  version: z.literal('1.0'),
  bundle_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  trace_id: z.string().min(1),
  requests: z.array(JobRequestSchema).min(1).max(100),
  metadata: z
    .object({
      source: z.string(),
      triggered_at: z.string().datetime(),
      correlation_id: z.string().optional(),
    })
    .passthrough(),
})

export type JobRequestBundle = z.infer<typeof JobRequestBundleSchema>
