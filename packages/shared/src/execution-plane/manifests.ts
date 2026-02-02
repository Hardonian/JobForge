/**
 * JobForge Execution Plane - Artifact Manifest Types
 * Canonical manifest format for job run outputs
 */

export type ManifestVersion = '1.0'

export type ManifestStatus = 'pending' | 'complete' | 'failed'

/**
 * Artifact output entry
 */
export interface ArtifactOutput {
  /** Output name */
  name: string
  /** Output type (e.g., 'file', 'json', 'report', 'image') */
  type: string
  /** Reference to stored output (URL, path, or ID) */
  ref: string
  /** Size in bytes (optional) */
  size?: number
  /** Checksum for integrity verification (optional) */
  checksum?: string
  /** MIME type (optional) */
  mime_type?: string
}

/**
 * Run metrics
 */
export interface RunMetrics {
  /** Duration in milliseconds */
  duration_ms?: number
  /** CPU time in milliseconds */
  cpu_ms?: number
  /** Peak memory usage in MB */
  memory_mb?: number
  /** Cost estimate (normalized units) */
  cost_estimate?: number
  /** Custom metrics */
  [key: string]: number | undefined
}

/**
 * Environment fingerprint
 */
export interface EnvFingerprint {
  /** Operating system */
  os?: string
  /** Architecture */
  arch?: string
  /** Node.js version (for TS workers) */
  node_version?: string
  /** Python version (for Py workers) */
  python_version?: string
  /** Additional environment details */
  [key: string]: string | undefined
}

/**
 * Tool versions used during execution
 */
export interface ToolVersions {
  /** JobForge version */
  jobforge?: string
  /** Connector versions */
  connectors?: Record<string, string>
  /** Additional tool versions */
  [key: string]: string | Record<string, string> | undefined
}

/**
 * Canonical Artifact Manifest
 * Every job run outputs this manifest structure
 */
export interface ArtifactManifest {
  /** Manifest schema version */
  manifest_version: ManifestVersion
  /** Run/job ID */
  run_id: string
  /** Tenant scope */
  tenant_id: string
  /** Optional project scope */
  project_id?: string
  /** Job type */
  job_type: string
  /** Manifest creation timestamp */
  created_at: string
  /** Reference to stored inputs snapshot */
  inputs_snapshot_ref?: string
  /** Reference to logs storage */
  logs_ref?: string
  /** Output artifacts */
  outputs: ArtifactOutput[]
  /** Run metrics */
  metrics: RunMetrics
  /** Environment fingerprint */
  env_fingerprint: EnvFingerprint
  /** Tool versions used */
  tool_versions: ToolVersions
  /** Manifest status */
  status: ManifestStatus
  /** Error details if status is 'failed' */
  error?: Record<string, unknown>
}

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
