/**
 * @jobforge/sdk-ts - TypeScript SDK for JobForge
 */

export { JobForgeClient } from './client'
export type { JobForgeClientConfig } from './client'

// Re-export shared types
export type {
  // Core types
  JobRow,
  JobResultRow,
  JobAttemptRow,
  ConnectorConfigRow,
  EnqueueJobParams,
  ClaimJobsParams,
  HeartbeatJobParams,
  CompleteJobParams,
  CancelJobParams,
  RescheduleJobParams,
  ListJobsParams,
  JobStatus,
  JobHandler,
  JobContext,
  JobTypeRegistry,
  // Execution plane types
  EventEnvelope,
  EventRow,
  SubmitEventParams,
  ListEventsParams,
  ArtifactManifest,
  ManifestRow,
  CreateManifestParams,
  GetManifestParams,
  JobTemplate,
  TemplateRow,
  RequestJobParams,
  RequestJobResult,
  PolicyToken,
  PolicyCheckResult,
  ValidatePolicyTokenParams,
  AuditLogEntry,
  AuditAction,
  Trigger,
  TriggerType,
  // Feature flags
  JOBFORGE_EVENTS_ENABLED,
  JOBFORGE_TRIGGERS_ENABLED,
  JOBFORGE_AUTOPILOT_JOBS_ENABLED,
  JOBFORGE_ACTION_JOBS_ENABLED,
  JOBFORGE_AUDIT_LOGGING_ENABLED,
  JOBFORGE_MANIFESTS_ENABLED,
  isEventIngestionAvailable,
  isTemplateEnabled,
  getFeatureFlagSummary,
} from '@jobforge/shared'
