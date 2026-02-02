/**
 * JobForge Deterministic Replay Bundle
 * Captures run provenance for deterministic replay
 * Feature flag: REPLAY_PACK_ENABLED=0 (default OFF)
 */

import { createHash } from 'crypto'
import { randomUUID } from 'crypto'
import { REPLAY_PACK_ENABLED } from './feature-flags'
import { redactObject } from './security'

// ============================================================================
// Replay Types
// ============================================================================

export interface InputSnapshot {
  /** Canonical JSON string (stable key order) */
  canonicalJson: string
  /** SHA-256 hash of canonical JSON */
  hash: string
  /** Original key order preserved for inspection */
  originalKeys: string[]
  /** Timestamp of snapshot */
  timestamp: string
}

export interface CodeFingerprint {
  /** Git commit SHA (if available) */
  gitSha: string | null
  /** Git branch (if available) */
  gitBranch: string | null
  /** Repository dirty status */
  gitDirty: boolean | null
  /** Timestamp of code fingerprint */
  timestamp: string
}

export interface RuntimeFingerprint {
  /** Node.js version */
  nodeVersion: string
  /** pnpm version */
  pnpmVersion: string | null
  /** Platform */
  platform: string
  /** Architecture */
  arch: string
  /** Timestamp */
  timestamp: string
}

export interface DependencyFingerprint {
  /** Lockfile hash (SHA-256) */
  lockfileHash: string | null
  /** Package.json hash (SHA-256) */
  packageHash: string | null
  /** Number of dependencies */
  dependencyCount: number | null
  /** Timestamp */
  timestamp: string
}

export interface EnvironmentFingerprint {
  /** Non-secret environment identifiers */
  identifiers: Record<string, string>
  /** Environment type (dev, staging, prod) */
  envType: string | null
  /** Feature flags enabled at runtime */
  featureFlags: Record<string, boolean | string>
  /** Timestamp */
  timestamp: string
}

export interface RunProvenance {
  /** Unique run identifier */
  runId: string
  /** Tenant scope */
  tenantId: string
  /** Project scope (optional) */
  projectId?: string
  /** Job type executed */
  jobType: string
  /** Input snapshot */
  inputs: InputSnapshot
  /** Code fingerprint */
  code: CodeFingerprint
  /** Runtime fingerprint */
  runtime: RuntimeFingerprint
  /** Dependency fingerprint */
  dependencies: DependencyFingerprint
  /** Environment fingerprint */
  environment: EnvironmentFingerprint
  /** Created at */
  createdAt: string
}

export interface ReplayBundle {
  /** Bundle format version */
  version: '1.0'
  /** Run provenance */
  provenance: RunProvenance
  /** Manifest reference */
  manifestRef?: string
  /** Log references */
  logRefs: string[]
  /** Artifact references */
  artifactRefs: string[]
  /** Replay metadata */
  metadata: {
    exportedAt: string
    exportedBy: string
    isDryRun: boolean
  }
}

export interface ReplayResult {
  /** Whether replay succeeded */
  success: boolean
  /** Original run ID */
  originalRunId: string
  /** Replay run ID (new) */
  replayRunId: string
  /** Differences found (if any) */
  differences: Array<{
    field: string
    original: unknown
    replayed: unknown
  }>
  /** Logs from replay */
  logs: string[]
  /** Timestamp */
  timestamp: string
}

// ============================================================================
// Fingerprinting Functions
// ============================================================================

/**
 * Canonicalize object for stable hashing
 * Sorts keys alphabetically, removes undefined values
 */
export function canonicalizeObject(obj: Record<string, unknown>): string {
  const sorted = sortKeys(obj)
  return JSON.stringify(sorted)
}

function sortKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(sortKeys)
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj).sort()
  for (const key of keys) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== undefined) {
      sorted[key] = sortKeys(value)
    }
  }
  return sorted
}

/**
 * Create input snapshot with canonicalization
 */
export function createInputSnapshot(inputs: Record<string, unknown>): InputSnapshot {
  const canonicalJson = canonicalizeObject(inputs)
  const hash = createHash('sha256').update(canonicalJson).digest('hex')

  return {
    canonicalJson,
    hash,
    originalKeys: Object.keys(inputs),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get code fingerprint (Git info)
 */
export async function getCodeFingerprint(): Promise<CodeFingerprint> {
  let gitSha: string | null = null
  let gitBranch: string | null = null
  let gitDirty: boolean | null = null

  try {
    // Dynamic import to avoid issues in environments without git
    const { execSync } = await import('child_process')

    try {
      gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8', timeout: 5000 }).trim()
    } catch {
      // Git not available
    }

    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
    } catch {
      // Git not available
    }

    try {
      const status = execSync('git status --porcelain', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim()
      gitDirty = status.length > 0
    } catch {
      // Git not available
    }
  } catch {
    // child_process not available (browser environment)
  }

  return {
    gitSha,
    gitBranch,
    gitDirty,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get runtime fingerprint
 */
export function getRuntimeFingerprint(): RuntimeFingerprint {
  return {
    nodeVersion: process.version,
    pnpmVersion: process.env.PNPM_VERSION || null,
    platform: process.platform,
    arch: process.arch,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get dependency fingerprint
 * In production, this would read actual lockfile
 */
export async function getDependencyFingerprint(): Promise<DependencyFingerprint> {
  // In a real implementation, this would:
  // 1. Read pnpm-lock.yaml
  // 2. Hash the lockfile
  // 3. Count dependencies

  // For now, return null values (will be populated in production)
  return {
    lockfileHash: null,
    packageHash: null,
    dependencyCount: null,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get environment fingerprint (non-secret identifiers only)
 */
export function getEnvironmentFingerprint(): EnvironmentFingerprint {
  // Collect non-secret environment identifiers
  const identifiers: Record<string, string> = {}

  // Safe environment variables (patterns that don't contain secrets)
  const safePatterns = [
    /^NODE_ENV$/,
    /^JOBFORGE_/, // Feature flags (not secrets)
    /^VERCEL_/,
    /^NETLIFY_/,
    /^RAILWAY_/,
    /^AWS_REGION$/,
    /^GCP_PROJECT$/,
    /^AZURE_LOCATION$/,
  ]

  for (const [key, value] of Object.entries(process.env)) {
    if (value && safePatterns.some((pattern) => pattern.test(key))) {
      // Exclude any that might contain secret-like patterns
      if (!/(SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL)/i.test(key)) {
        identifiers[key] = value
      }
    }
  }

  return {
    identifiers: redactObject(identifiers),
    envType: process.env.NODE_ENV || null,
    featureFlags: getFeatureFlagSnapshot(),
    timestamp: new Date().toISOString(),
  }
}

/**
 * Get snapshot of feature flags
 */
function getFeatureFlagSnapshot(): Record<string, boolean | string> {
  const flags: Record<string, boolean | string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('JOBFORGE_') || key.startsWith('REPLAY_') || key.startsWith('VERIFY_')) {
      // Only include enabled/disabled flags, not secrets
      if (value === '1' || value === '0' || value === 'true' || value === 'false') {
        flags[key] = value === '1' || value === 'true'
      }
    }
  }

  return flags
}

// ============================================================================
// Provenance Capture
// ============================================================================

/**
 * Capture complete run provenance
 * Returns null if REPLAY_PACK_ENABLED=0
 */
export async function captureRunProvenance(
  runId: string,
  tenantId: string,
  jobType: string,
  inputs: Record<string, unknown>,
  projectId?: string
): Promise<RunProvenance | null> {
  if (!REPLAY_PACK_ENABLED) {
    return null
  }

  const [code, runtime, dependencies, environment] = await Promise.all([
    getCodeFingerprint(),
    getRuntimeFingerprint(),
    getDependencyFingerprint(),
    getEnvironmentFingerprint(),
  ])

  return {
    runId,
    tenantId,
    projectId,
    jobType,
    inputs: createInputSnapshot(inputs),
    code,
    runtime,
    dependencies,
    environment,
    createdAt: new Date().toISOString(),
  }
}

// ============================================================================
// Replay Bundle Export
// ============================================================================

/**
 * Export replay bundle for a run
 * Returns null if REPLAY_PACK_ENABLED=0
 */
export async function exportReplayBundle(
  runId: string,
  tenantId: string,
  jobType: string,
  inputs: Record<string, unknown>,
  options: {
    projectId?: string
    manifestRef?: string
    logRefs?: string[]
    artifactRefs?: string[]
    isDryRun?: boolean
    exportedBy?: string
  } = {}
): Promise<ReplayBundle | null> {
  if (!REPLAY_PACK_ENABLED) {
    return null
  }

  const provenance = await captureRunProvenance(runId, tenantId, jobType, inputs, options.projectId)

  if (!provenance) {
    return null
  }

  return {
    version: '1.0',
    provenance,
    manifestRef: options.manifestRef,
    logRefs: options.logRefs || [],
    artifactRefs: options.artifactRefs || [],
    metadata: {
      exportedAt: new Date().toISOString(),
      exportedBy: options.exportedBy || 'system',
      isDryRun: options.isDryRun ?? false,
    },
  }
}

// ============================================================================
// Replay Dry-Run
// ============================================================================

/**
 * Replay a run in dry-run mode (simulation)
 * Does not execute actual side effects
 */
export async function replayDryRun(
  bundle: ReplayBundle,
  options: {
    compareResults?: boolean
    maxLogLines?: number
  } = {}
): Promise<ReplayResult> {
  const replayRunId = randomUUID()
  const logs: string[] = []
  const differences: Array<{ field: string; original: unknown; replayed: unknown }> = []

  logs.push(
    `[${new Date().toISOString()}] Starting dry-run replay of run ${bundle.provenance.runId}`
  )
  logs.push(`[${new Date().toISOString()}] Replay run ID: ${replayRunId}`)
  logs.push(`[${new Date().toISOString()}] Job type: ${bundle.provenance.jobType}`)
  logs.push(`[${new Date().toISOString()}] Tenant: ${bundle.provenance.tenantId}`)

  // Validate input hash matches
  const currentInputs = bundle.provenance.inputs.canonicalJson
  const currentHash = createHash('sha256').update(currentInputs).digest('hex')

  if (currentHash !== bundle.provenance.inputs.hash) {
    differences.push({
      field: 'inputs.hash',
      original: bundle.provenance.inputs.hash,
      replayed: currentHash,
    })
    logs.push(`[${new Date().toISOString()}] WARNING: Input hash mismatch detected`)
  }

  // Check code fingerprint
  const currentCode = await getCodeFingerprint()
  if (currentCode.gitSha !== bundle.provenance.code.gitSha) {
    differences.push({
      field: 'code.gitSha',
      original: bundle.provenance.code.gitSha,
      replayed: currentCode.gitSha,
    })
    logs.push(`[${new Date().toISOString()}] INFO: Code version differs from original`)
    logs.push(`[${new Date().toISOString()}]   Original: ${bundle.provenance.code.gitSha}`)
    logs.push(`[${new Date().toISOString()}]   Current: ${currentCode.gitSha}`)
  }

  // Check runtime fingerprint
  const currentRuntime = getRuntimeFingerprint()
  if (currentRuntime.nodeVersion !== bundle.provenance.runtime.nodeVersion) {
    differences.push({
      field: 'runtime.nodeVersion',
      original: bundle.provenance.runtime.nodeVersion,
      replayed: currentRuntime.nodeVersion,
    })
    logs.push(`[${new Date().toISOString()}] INFO: Runtime version differs`)
  }

  // Simulate execution
  logs.push(`[${new Date().toISOString()}] Simulating job execution...`)
  logs.push(`[${new Date().toISOString()}] Dry-run complete - no side effects occurred`)

  const maxLines = options.maxLogLines || 1000
  const trimmedLogs = logs.slice(0, maxLines)
  if (logs.length > maxLines) {
    trimmedLogs.push(
      `[${new Date().toISOString()}] ... ${logs.length - maxLines} log lines truncated`
    )
  }

  return {
    success: true,
    originalRunId: bundle.provenance.runId,
    replayRunId,
    differences,
    logs: trimmedLogs,
    timestamp: new Date().toISOString(),
  }
}

// ============================================================================
// Hash Verification
// ============================================================================

/**
 * Verify that an input matches its expected hash
 */
export function verifyInputHash(inputs: Record<string, unknown>, expectedHash: string): boolean {
  const snapshot = createInputSnapshot(inputs)
  return snapshot.hash === expectedHash
}

/**
 * Compare two replay bundles for equality
 */
export function compareBundles(
  a: ReplayBundle,
  b: ReplayBundle
): {
  equal: boolean
  differences: string[]
} {
  const differences: string[] = []

  if (a.provenance.inputs.hash !== b.provenance.inputs.hash) {
    differences.push('inputs.hash')
  }

  if (a.provenance.code.gitSha !== b.provenance.code.gitSha) {
    differences.push('code.gitSha')
  }

  if (a.provenance.runtime.nodeVersion !== b.provenance.runtime.nodeVersion) {
    differences.push('runtime.nodeVersion')
  }

  if (a.provenance.dependencies.lockfileHash !== b.provenance.dependencies.lockfileHash) {
    differences.push('dependencies.lockfileHash')
  }

  return {
    equal: differences.length === 0,
    differences,
  }
}
