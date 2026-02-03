/**
 * JobForge Execution Plane - Artifact Manifest Types
 * Canonical manifest format for job run outputs
 */

export type {
  ArtifactManifest,
  ArtifactOutput,
  EnvFingerprint,
  ManifestStatus,
  ManifestVersion,
  RunMetrics,
  ToolVersions,
} from '@autopilot/contracts'

/**
 * Manifest row from database
 */
export interface ManifestRow {
  id: string
  run_id: string
  tenant_id: string
  project_id: string | null
  manifest_version: string
  job_type: string
  created_at: string
  inputs_snapshot_ref: string | null
  logs_ref: string | null
  outputs: ArtifactOutput[]
  metrics: RunMetrics
  env_fingerprint: EnvFingerprint
  tool_versions: ToolVersions
  status: ManifestStatus
  error: Record<string, unknown> | null
}

/**
 * Parameters for creating a manifest
 */
export interface CreateManifestParams {
  run_id: string
  tenant_id: string
  job_type: string
  project_id?: string
  inputs_snapshot_ref?: string
  logs_ref?: string
  outputs?: ArtifactOutput[]
  metrics?: RunMetrics
  env_fingerprint?: EnvFingerprint
  tool_versions?: ToolVersions
}

/**
 * Parameters for retrieving a manifest
 */
export interface GetManifestParams {
  run_id: string
  tenant_id: string
}

/**
 * Markdown report generation options
 */
export interface ManifestReportOptions {
  /** Include inputs section */
  include_inputs?: boolean
  /** Include metrics section */
  include_metrics?: boolean
  /** Include environment section */
  include_env?: boolean
  /** Max outputs to list */
  max_outputs?: number
}
