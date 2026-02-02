/**
 * @jobforge/client - TypeScript client for JobForge execution plane
 *
 * Provides a unified interface for:
 * - Submitting event envelopes
 * - Requesting job execution
 * - Querying run status and manifests
 * - Listing artifacts
 *
 * Supports two transport modes:
 * 1. Direct (via @jobforge/sdk-ts) - for same-monorepo usage
 * 2. HTTP - for remote API access (if JobForge has HTTP endpoint)
 *
 * @example
 * ```typescript
 * import { createClient } from '@jobforge/client'
 *
 * const client = createClient({
 *   supabaseUrl: process.env.SUPABASE_URL!,
 *   supabaseKey: process.env.SUPABASE_SERVICE_KEY!,
 * })
 *
 * // Submit an event
 * await client.submitEvent({
 *   event_version: '1.0',
 *   event_type: 'user.action',
 *   occurred_at: new Date().toISOString(),
 *   trace_id: 'trace-123',
 *   tenant_id: 'tenant-456',
 *   source_app: 'settler',
 *   payload: { action: 'click' },
 *   contains_pii: false,
 * })
 * ```
 */

// Main client
export { ExecutionPlaneClient, createClient, verifyIntegration } from './client'

// Types
export type {
  JobForgeClientConfig,
  SubmitEventParams,
  RequestJobParams,
  RequestJobResult,
  GetRunStatusParams,
  RunStatus,
  GetRunManifestParams,
  ListArtifactsParams,
  ListArtifactsResult,
  Transport,
  ClientErrorCode,
  JobForgeClientError,
  // Re-export shared types
  EventEnvelope,
  EventRow,
  ManifestRow,
  SourceApp,
  SourceModule,
  RedactionHints,
  EventVersion,
  ArtifactOutput,
} from './types'

// JobForgeClientError is already exported from types above

// Transports
export { DirectTransport } from './transports/direct'
export { HttpTransport } from './transports/http'

// Feature flags
export {
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_DRY_RUN_MODE,
  JOBFORGE_API_ENDPOINT,
  JOBFORGE_API_KEY,
  isIntegrationEnabled,
  isDryRunMode,
  getFeatureFlagSummary,
  verifyIntegrationAvailable,
} from './feature-flags'

// Schemas (for advanced use)
export {
  jobForgeClientConfigSchema,
  eventEnvelopeSchema,
  submitEventParamsSchema,
  requestJobParamsSchema,
  requestJobResultSchema,
  runStatusSchema,
  getRunStatusParamsSchema,
  getRunManifestParamsSchema,
  listArtifactsParamsSchema,
  listArtifactsResultSchema,
  artifactOutputSchema,
} from './schemas'
