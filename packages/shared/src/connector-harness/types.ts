/**
 * Connector Harness - Canonical Types
 *
 * Defines the single canonical interface every connector must implement:
 *   runConnector({ config, input, context }): Promise<ConnectorResult>
 *
 * Evidence packets are always emitted (even on failure).
 */

import { z } from 'zod'

// ============================================================================
// Connector Config Schema
// ============================================================================

export const ConnectorConfigSchema = z.object({
  /** Unique connector identifier */
  connector_id: z.string().min(1),
  /** Auth type required by this connector */
  auth_type: z.enum(['oauth2', 'api_key', 'bearer', 'basic', 'none']),
  /** Connector-specific configuration (validated per-connector) */
  settings: z.record(z.string(), z.unknown()).default({}),
  /** Retry policy override */
  retry_policy: z
    .object({
      max_retries: z.number().int().min(0).max(10).default(3),
      base_delay_ms: z.number().int().positive().default(1000),
      max_delay_ms: z.number().int().positive().default(30000),
      backoff_multiplier: z.number().positive().default(2),
    })
    .default({}),
  /** Timeout in milliseconds */
  timeout_ms: z.number().int().positive().default(30000),
  /** Rate limit (requests per second) */
  rate_limit_rps: z.number().positive().optional(),
})

export type ConnectorConfig = z.infer<typeof ConnectorConfigSchema>

// ============================================================================
// Connector Input Schema
// ============================================================================

export const ConnectorInputSchema = z.object({
  /** Operation to execute */
  operation: z.string().min(1),
  /** Operation payload */
  payload: z.record(z.string(), z.unknown()).default({}),
  /** Idempotency key for exactly-once semantics */
  idempotency_key: z.string().min(1).optional(),
})

export type ConnectorInput = z.infer<typeof ConnectorInputSchema>

// ============================================================================
// Connector Context Schema
// ============================================================================

export const ConnectorContextSchema = z.object({
  /** Trace ID for distributed tracing */
  trace_id: z.string().min(1),
  /** Tenant ID */
  tenant_id: z.string().uuid(),
  /** Project ID */
  project_id: z.string().uuid().optional(),
  /** Actor performing the operation */
  actor_id: z.string().optional(),
  /** Whether this is a dry run */
  dry_run: z.boolean().default(false),
  /** Attempt number (1-based) */
  attempt_no: z.number().int().positive().default(1),
})

export type ConnectorContext = z.infer<typeof ConnectorContextSchema>

// ============================================================================
// Evidence Packet Schema
// ============================================================================

export const EvidencePacketSchema = z.object({
  /** Unique evidence ID */
  evidence_id: z.string().min(1),
  /** Connector that produced this evidence */
  connector_id: z.string().min(1),
  /** Trace ID for correlation */
  trace_id: z.string().min(1),
  /** When the operation started */
  started_at: z.string().datetime(),
  /** When the operation ended */
  ended_at: z.string().datetime(),
  /** Total duration in milliseconds */
  duration_ms: z.number().nonnegative(),
  /** Number of retries attempted */
  retries: z.number().int().nonnegative(),
  /** HTTP status codes seen (in order) */
  status_codes: z.array(z.number().int()),
  /** Redacted input (sensitive fields replaced) */
  redacted_input: z.record(z.string(), z.unknown()),
  /** SHA-256 hash of canonical output */
  output_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** SHA-256 hash of the entire evidence packet (computed last) */
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
  /** Whether the operation succeeded */
  ok: z.boolean(),
  /** Error details if failed */
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  /** Backoff delays used (in ms) */
  backoff_delays_ms: z.array(z.number().nonnegative()),
  /** Whether rate limit was hit */
  rate_limited: z.boolean(),
  /** Tenant and project for scoping */
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
})

export type EvidencePacket = z.infer<typeof EvidencePacketSchema>

// ============================================================================
// Connector Result Schema
// ============================================================================

export const ConnectorResultSchema = z.object({
  /** Whether the operation succeeded */
  ok: z.boolean(),
  /** Result data (only on success) */
  data: z.unknown().optional(),
  /** Error details (only on failure) */
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      userMessage: z.string().optional(),
      retryable: z.boolean(),
      debug: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  /** Evidence packet (always present) */
  evidence: EvidencePacketSchema,
})

export type ConnectorResult = z.infer<typeof ConnectorResultSchema>

// ============================================================================
// Connector Manifest Schema
// ============================================================================

export const ConnectorManifestSchema = z.object({
  /** Connector ID (must match metadata) */
  connector_id: z.string().min(1),
  /** Human-readable name */
  name: z.string().min(1),
  /** Connector version */
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  /** Description */
  description: z.string().min(1),
  /** Connector type */
  connector_type: z.enum(['source', 'destination', 'transform', 'utility']),
  /** Auth type */
  auth_type: z.enum(['oauth2', 'api_key', 'bearer', 'basic', 'none']),
  /** Supported operations */
  supported_operations: z.array(z.string().min(1)).min(1),
  /** Rate limits */
  rate_limits: z.object({
    requests_per_second: z.number().positive(),
    burst_size: z.number().positive(),
  }),
  /** Retry policy defaults */
  retry_policy: z.object({
    max_retries: z.number().int().min(0).max(10),
    base_delay_ms: z.number().int().positive(),
    max_delay_ms: z.number().int().positive(),
    backoff_multiplier: z.number().positive(),
  }),
  /** Config schema for validation */
  config_schema: z.record(z.string(), z.unknown()),
  /** Capabilities */
  capabilities: z.array(z.string()),
})

export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>

// ============================================================================
// runConnector Function Type
// ============================================================================

export interface RunConnectorParams {
  config: ConnectorConfig
  input: ConnectorInput
  context: ConnectorContext
}

/**
 * The canonical connector function signature.
 * Every connector must satisfy this interface.
 */
export type ConnectorFn = (params: RunConnectorParams) => Promise<ConnectorResult>

// ============================================================================
// Secret Denylist (fields that must ALWAYS be redacted)
// ============================================================================

export const SECRET_DENYLIST: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'api_key',
  'apiKey',
  'apikey',
  'auth_token',
  'authToken',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'token',
  'bearer',
  'credential',
  'credentials',
  'private_key',
  'privateKey',
  'client_secret',
  'clientSecret',
  'webhook_secret',
  'signing_key',
  'encryption_key',
  'jwt',
  'session_id',
  'cookie',
  'authorization',
  'ssn',
  'credit_card',
  'creditCard',
] as const

/**
 * Fields that are safe to keep in evidence (allowlist).
 * Only used if you want to restrict evidence to ONLY these fields.
 */
export const EVIDENCE_ALLOWLIST: readonly string[] = [
  'connector_id',
  'operation',
  'tenant_id',
  'project_id',
  'trace_id',
  'actor_id',
  'dry_run',
  'attempt_no',
  'idempotency_key',
] as const
