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
  payload: z.record(z.unknown()),
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
  payload: z.record(z.unknown()),
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

export const runMetricsSchema = z.record(z.number().positive().optional())
export const envFingerprintSchema = z.record(z.string().optional())
export const toolVersionsSchema = z.record(z.union([z.string(), z.record(z.string())]).optional())

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
  error: z.record(z.unknown()).optional(),
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
