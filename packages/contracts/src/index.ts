/**
 * Autopilot Contracts
 * Canonical schema and types for cross-module interoperability.
 */

import { createHash } from 'crypto'
import { z } from 'zod'

export const SCHEMA_VERSION = '1.0.0' as const

// ============================================================================
// Event Envelope
// ============================================================================

export const eventVersionSchema = z.literal('1.0')

export type EventVersion = z.infer<typeof eventVersionSchema>

export const sourceAppSchema = z.enum([
  'settler',
  'aias',
  'keys',
  'readylayer',
  'jobforge',
  'external',
])

export type SourceApp = z.infer<typeof sourceAppSchema>

export const sourceModuleSchema = z.enum(['ops', 'support', 'growth', 'finops', 'core'])

export type SourceModule = z.infer<typeof sourceModuleSchema>

export const eventSubjectSchema = z.object({
  type: z.string(),
  id: z.string(),
})

export type EventSubject = z.infer<typeof eventSubjectSchema>

export const redactionHintsSchema = z.object({
  redact_fields: z.array(z.string()).optional(),
  encrypt_fields: z.array(z.string()).optional(),
  retention_days: z.number().int().positive().optional(),
})

export type RedactionHints = z.infer<typeof redactionHintsSchema>

export const EventEnvelopeSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
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
  payload: z.record(z.string(), z.unknown()),
  contains_pii: z.boolean(),
  redaction_hints: redactionHintsSchema.optional(),
})

export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>

// ============================================================================
// Job Request Bundle
// ============================================================================

export const JobRequestSchema = z.object({
  id: z.string().min(1),
  job_type: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  payload: z.record(z.string(), z.unknown()),
  idempotency_key: z.string().min(1),
  required_scopes: z.array(z.string()).default([]),
  is_action_job: z.boolean().default(false),
})

export type JobRequest = z.infer<typeof JobRequestSchema>

export const JobRequestBundleSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
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

// ============================================================================
// Run Manifest (Artifact Manifest)
// ============================================================================

export const manifestVersionSchema = z.literal('1.0')
export const manifestStatusSchema = z.enum(['pending', 'complete', 'failed'])

export const artifactOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  ref: z.string(),
  size: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  mime_type: z.string().optional(),
})

export const runMetricsSchema = z.record(z.string(), z.number().positive().optional())
export const envFingerprintSchema = z.record(z.string(), z.string().optional())
export const toolVersionsSchema = z.record(
  z.string(),
  z.union([z.string(), z.record(z.string(), z.string())]).optional()
)

export const RunManifestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
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
  error: z.record(z.string(), z.unknown()).optional(),
})

export type RunManifest = z.infer<typeof RunManifestSchema>

export type ArtifactOutput = z.infer<typeof artifactOutputSchema>
export type RunMetrics = z.infer<typeof runMetricsSchema>
export type EnvFingerprint = z.infer<typeof envFingerprintSchema>
export type ToolVersions = z.infer<typeof toolVersionsSchema>
export type ManifestStatus = z.infer<typeof manifestStatusSchema>
export type ManifestVersion = z.infer<typeof manifestVersionSchema>

// Backwards-compatible export names
export const ArtifactManifestSchema = RunManifestSchema
export type ArtifactManifest = RunManifest

// ============================================================================
// Report Envelope
// ============================================================================

export const ReportEnvelopeSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  report_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  trace_id: z.string().min(1),
  module_id: sourceModuleSchema,
  report_type: z.string().min(1),
  created_at: z.string().datetime(),
  summary: z.record(z.string(), z.unknown()).optional(),
  artifacts: z.array(artifactOutputSchema).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  redaction_hints: redactionHintsSchema.optional(),
})

export type ReportEnvelope = z.infer<typeof ReportEnvelopeSchema>

// ============================================================================
// Canonical JSON
// ============================================================================

export function canonicalizeJson(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return ''

  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'

  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(',')}]`
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const pairs = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalizeJson(record[key])}`)
    return `{${pairs.join(',')}}`
  }

  return JSON.stringify(value)
}

export function hashCanonicalJson(value: unknown): string {
  const canonical = canonicalizeJson(value)
  return createHash('sha256').update(canonical).digest('hex')
}

// ============================================================================
// Redaction Helpers
// ============================================================================

const DEFAULT_REDACT_FIELDS = ['password', 'secret', 'token', 'key', 'credential', 'apiKey']

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return '[REDACTED]'
  }
  if (Array.isArray(value)) {
    return value.map(() => '[REDACTED]')
  }
  if (value && typeof value === 'object') {
    return '[REDACTED]'
  }
  return '[REDACTED]'
}

export function redactObject<T extends Record<string, unknown>>(
  obj: T,
  options?: {
    redactFields?: string[]
    maxDepth?: number
  }
): T {
  const redactFields = options?.redactFields ?? DEFAULT_REDACT_FIELDS
  const maxDepth = options?.maxDepth ?? 8

  function redactDeep(value: unknown, depth: number): unknown {
    if (depth > maxDepth) return value
    if (Array.isArray(value)) {
      return value.map((item) => redactDeep(item, depth + 1))
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      const next: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(record)) {
        const shouldRedact = redactFields.some((field) =>
          key.toLowerCase().includes(field.toLowerCase())
        )
        next[key] = shouldRedact ? redactValue(val) : redactDeep(val, depth + 1)
      }
      return next
    }
    return value
  }

  return redactDeep(obj, 0) as T
}

// ============================================================================
// Connector Capabilities
// ============================================================================

export const ConnectorCapabilitySchema = z.object({
  connector_id: z.string().min(1),
  connector_type: z.enum(['source', 'destination', 'transform', 'utility']),
  name: z.string().min(1),
  description: z.string().optional(),
  version: z.string().min(1),
  supported_job_types: z.array(z.string().min(1)),
  required_scopes: z.array(z.string()).default([]),
  required_capabilities: z.array(z.string()).default([]),
  config_schema: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
})

export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>

export const RunnerCapabilitiesSchema = z.object({
  runner_id: z.string().min(1),
  runner_type: z.enum(['local', 'docker', 'kubernetes', 'remote']),
  version: z.string().min(1),
  supported_connectors: z.array(z.string().min(1)),
  max_concurrent_jobs: z.number().int().positive().default(1),
  resource_limits: z
    .object({
      cpu_cores: z.number().positive().optional(),
      memory_mb: z.number().int().positive().optional(),
      disk_mb: z.number().int().positive().optional(),
    })
    .optional(),
  features: z
    .array(
      z.enum([
        'streaming_logs',
        'artifact_upload',
        'artifact_download',
        'secret_injection',
        'env_var_injection',
        'network_access',
        'gpu_access',
      ])
    )
    .default([]),
  enabled: z.boolean().default(true),
})

export type RunnerCapabilities = z.infer<typeof RunnerCapabilitiesSchema>

// ============================================================================
// Registry Handshake
// ============================================================================

export const RegistryHandshakeRequestSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  instance_id: z.string().min(1),
  instance_type: z.literal('jobforge'),
  version: z.string().min(1),
  connectors: z.array(ConnectorCapabilitySchema).min(1),
  runner_capabilities: RunnerCapabilitiesSchema,
  metadata: z.record(z.unknown()).optional(),
  timestamp: z.string().datetime(),
})

export type RegistryHandshakeRequest = z.infer<typeof RegistryHandshakeRequestSchema>

export const RegistryHandshakeResponseSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION),
  handshake_id: z.string().min(1),
  status: z.enum(['accepted', 'rejected', 'partial']),
  accepted_connectors: z.array(z.string()),
  rejected_connectors: z.array(
    z.object({
      connector_id: z.string(),
      reason: z.string(),
    })
  ),
  runner_validation: z.object({
    valid: z.boolean(),
    missing_capabilities: z.array(z.string()),
    warnings: z.array(z.string()),
  }),
  control_plane_version: z.string(),
  timestamp: z.string().datetime(),
})

export type RegistryHandshakeResponse = z.infer<typeof RegistryHandshakeResponseSchema>

// ============================================================================
// Error Envelope (matches @jobforge/errors structure)
// ============================================================================

export const ErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'VALIDATION_ERROR',
  'RATE_LIMIT_EXCEEDED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
  'DATABASE_ERROR',
  'EXTERNAL_SERVICE_ERROR',
  'TIMEOUT_ERROR',
])

export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const ValidationErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
  code: z.string().optional(),
})

export type ValidationErrorDetail = z.infer<typeof ValidationErrorDetailSchema>

export const ErrorEnvelopeSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string().min(1),
  correlationId: z.string().optional(),
  details: z.union([z.array(ValidationErrorDetailSchema), z.record(z.unknown())]).optional(),
  stack: z.string().optional(),
  timestamp: z.string().datetime(),
})

export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>
