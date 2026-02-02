/**
 * @jobforge/integration - App-specific adapters
 *
 * Pre-configured adapters for Settler, ReadyLayer, Keys, and AIAS.
 * Each adapter provides app-specific helper methods while inheriting
 * the base functionality from JobForgeAdapter.
 */

export { JobForgeAdapter, createJobForgeAdapter } from './adapter'
export type {
  JobForgeAdapterConfig,
  SubmitEventOptions,
  RequestJobOptions,
  JobStatusResult,
} from './adapter'

export {
  generateTraceId,
  createTraceContext,
  extractTraceFromHeaders,
  createTraceHeaders,
  propagateTraceToJobPayload,
  extractTraceFromJobPayload,
  traceContextStore,
  TRACE_ID_HEADER,
  TRACE_CONTEXT_KEY,
} from './trace'
export type { TraceContext } from './trace'

export {
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_INTEGRATION_DRY_RUN,
  isIntegrationEnabled,
  getTenantMapping,
  getProjectMapping,
  getIntegrationConfig,
  getIntegrationFlagSummary,
} from './feature-flags'
