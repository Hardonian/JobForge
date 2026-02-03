/**
 * @jobforge/client - Zod schemas
 * Runtime validation for client types
 */

import { z } from 'zod'
import {
  eventVersionSchema,
  sourceAppSchema,
  sourceModuleSchema,
  redactionHintsSchema,
  eventSubjectSchema,
} from '@jobforge/shared'
import { SCHEMA_VERSION } from '@autopilot/contracts'

// ============================================================================
// Client Configuration Schema
// ============================================================================

export const jobForgeClientConfigSchema = z.object({
  supabaseUrl: z.string().url().optional(),
  supabaseKey: z.string().optional(),
  apiEndpoint: z.string().url().optional(),
  apiKey: z.string().optional(),
  defaultTenantId: z.string().uuid().optional(),
  dryRun: z.boolean().default(false),
})

// ============================================================================
// Event Envelope Schema
// ============================================================================

export const eventEnvelopeSchema = z.object({
  schema_version: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  event_version: eventVersionSchema.default('1.0'),
  event_type: z.string().min(1, 'Event type is required'),
  occurred_at: z.string().datetime(),
  trace_id: z.string().min(1, 'Trace ID is required'),
  actor_id: z.string().optional(),
  tenant_id: z.string().uuid('Tenant ID must be a valid UUID'),
  project_id: z.string().uuid().optional(),
  source_app: sourceAppSchema,
  source_module: sourceModuleSchema.optional(),
  subject: eventSubjectSchema.optional(),
  payload: z.record(z.unknown()).default({}),
  contains_pii: z.boolean().default(false),
  redaction_hints: redactionHintsSchema.optional(),
})

export const submitEventParamsSchema = z.object({
  envelope: eventEnvelopeSchema,
})

// ============================================================================
// Request Job Schema
// ============================================================================

export const requestJobParamsSchema = z.object({
  jobType: z.string().min(1, 'Job type is required'),
  inputs: z.record(z.unknown()).default({}),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
  projectId: z.string().uuid().optional(),
  traceId: z.string().min(1, 'Trace ID is required'),
  idempotencyKey: z.string().optional(),
  actorId: z.string().optional(),
  sourceApp: sourceAppSchema,
  sourceModule: sourceModuleSchema.optional(),
  dryRun: z.boolean().default(false),
})

export const requestJobResultSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  traceId: z.string(),
  dryRun: z.boolean(),
  timestamp: z.string().datetime(),
})

// ============================================================================
// Run Status Schema
// ============================================================================

export const runStatusSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  progress: z.number().int().min(0).max(100).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.unknown()).optional(),
    })
    .optional(),
})

export const getRunStatusParamsSchema = z.object({
  runId: z.string().uuid('Run ID must be a valid UUID'),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
})

// ============================================================================
// Run Manifest Schema
// ============================================================================

export const getRunManifestParamsSchema = z.object({
  runId: z.string().uuid('Run ID must be a valid UUID'),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
})

// ============================================================================
// Artifacts Schema
// ============================================================================

export const artifactOutputSchema = z.object({
  name: z.string(),
  type: z.string(),
  ref: z.string(),
  size: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  mime_type: z.string().optional(),
})

export const listArtifactsParamsSchema = z.object({
  runId: z.string().uuid('Run ID must be a valid UUID'),
  tenantId: z.string().uuid('Tenant ID must be a valid UUID'),
})

export const listArtifactsResultSchema = z.object({
  runId: z.string().uuid(),
  artifacts: z.array(artifactOutputSchema),
  totalCount: z.number().int().nonnegative(),
})

// ============================================================================
// Error Schema
// ============================================================================

export const clientErrorCodeSchema = z.enum([
  'INTEGRATION_DISABLED',
  'VALIDATION_ERROR',
  'TRANSPORT_ERROR',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
])
