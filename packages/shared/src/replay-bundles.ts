/**
 * JobForge Replay Bundle System
 * Import and replay bundles for testing, debugging, and recovery
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import type { JobRequestBundle, JobRequest } from './execution-plane/schemas.js'
import { JobRequestBundleSchema } from './execution-plane/schemas.js'
import { z } from 'zod'

// ============================================================================
// Replay Bundle Types
// ============================================================================

export interface JobReplayBundle {
  version: '1.0'
  replay_id: string
  original_run_id: string
  captured_at: string
  tenant_id: string
  project_id?: string
  job_type: string
  payload: Record<string, unknown>
  result?: Record<string, unknown>
  metadata?: {
    captured_by?: string
    capture_reason?: string
    source_environment?: string
    tags?: string[]
  }
}

export interface ReplayImportResult {
  success: boolean
  replay_id?: string
  bundle?: JobRequestBundle
  errors: string[]
  warnings: string[]
}

export interface ReplayOptions {
  /** Override tenant ID (requires admin permissions) */
  overrideTenantId?: string
  /** Override project ID */
  overrideProjectId?: string
  /** Force dry-run mode regardless of original mode */
  forceDryRun?: boolean
  /** Skip action jobs */
  skipActionJobs?: boolean
  /** Add additional metadata */
  additionalMetadata?: Record<string, unknown>
}

// ============================================================================
// Replay Bundle Validation
// ============================================================================

export const JobReplayBundleSchema = z.object({
  version: z.literal('1.0'),
  replay_id: z.string().min(1),
  original_run_id: z.string().min(1),
  captured_at: z.string().datetime(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  job_type: z.string().min(1),
  payload: z.record(z.unknown()),
  result: z.record(z.unknown()).optional(),
  metadata: z
    .object({
      captured_by: z.string().optional(),
      capture_reason: z.string().optional(),
      source_environment: z.string().optional(),
      tags: z.array(z.string()).optional(),
    })
    .optional(),
})

// ============================================================================
// Import Functions
// ============================================================================

/**
 * Load a replay bundle from a file
 */
export async function loadReplayBundle(filePath: string): Promise<JobReplayBundle> {
  const content = await fs.readFile(filePath, 'utf-8')
  const parsed = JSON.parse(content)

  const result = JobReplayBundleSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Invalid replay bundle: ${result.error.errors.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    )
  }

  return result.data
}

/**
 * Load a replay bundle from JSON string
 */
export function parseReplayBundle(jsonString: string): JobReplayBundle {
  const parsed = JSON.parse(jsonString)

  const result = JobReplayBundleSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(
      `Invalid replay bundle: ${result.error.errors.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
    )
  }

  return result.data
}

/**
 * Convert a replay bundle back to a JobRequestBundle
 */
export function convertReplayToBundle(
  replay: JobReplayBundle,
  options?: ReplayOptions
): { bundle: JobRequestBundle; warnings: string[] } {
  const warnings: string[] = []

  // Determine tenant/project
  const tenantId = options?.overrideTenantId || replay.tenant_id
  const projectId = options?.overrideProjectId || replay.project_id

  if (options?.overrideTenantId && options.overrideTenantId !== replay.tenant_id) {
    warnings.push(`Tenant ID overridden: ${replay.tenant_id} -> ${options.overrideTenantId}`)
  }

  // Extract the original bundle from the payload if it exists
  const originalBundle = replay.payload.request_bundle as JobRequestBundle | undefined

  if (!originalBundle) {
    // Create a minimal bundle from the replay data
    warnings.push('No original bundle found in replay, creating synthetic bundle')

    const syntheticRequest: JobRequest = {
      id: `replay-${Date.now()}-001`,
      job_type: replay.job_type,
      tenant_id: tenantId,
      project_id: projectId,
      payload: replay.payload,
      idempotency_key: `replay-${replay.replay_id}`,
      required_scopes: ['ops:read'],
      is_action_job: false,
    }

    const bundle: JobRequestBundle = {
      version: '1.0',
      bundle_id: `replay-bundle-${Date.now()}`,
      tenant_id: tenantId,
      project_id: projectId,
      trace_id: replay.replay_id,
      requests: [syntheticRequest],
      metadata: {
        source: 'replay-import',
        triggered_at: new Date().toISOString(),
        correlation_id: replay.original_run_id,
        ...options?.additionalMetadata,
      },
    }

    return { bundle, warnings }
  }

  // Modify the original bundle based on options
  const modifiedRequests = originalBundle.requests
    .map((req, index) => {
      const modified: JobRequest = {
        ...req,
        id: `${req.id}-replay-${index}`,
        tenant_id: tenantId,
        project_id: projectId,
        idempotency_key: `replay-${replay.replay_id}-${req.id}`,
      }

      // Force dry-run if requested
      if (options?.forceDryRun && modified.is_action_job) {
        warnings.push(`Forcing dry-run for action job: ${modified.job_type}`)
        modified.is_action_job = false
      }

      // Skip action jobs if requested
      if (options?.skipActionJobs && req.is_action_job) {
        warnings.push(`Skipping action job: ${req.job_type}`)
        return null
      }

      return modified
    })
    .filter((req): req is JobRequest => req !== null)

  if (modifiedRequests.length === 0) {
    throw new Error(
      'All requests were filtered out (all were action jobs and skipActionJobs is enabled)'
    )
  }

  const bundle: JobRequestBundle = {
    version: '1.0',
    bundle_id: `replay-bundle-${Date.now()}`,
    tenant_id: tenantId,
    project_id: projectId,
    trace_id: replay.replay_id,
    requests: modifiedRequests,
    metadata: {
      source: 'replay-import',
      triggered_at: new Date().toISOString(),
      correlation_id: replay.original_run_id,
      replay_metadata: replay.metadata,
      ...options?.additionalMetadata,
    },
  }

  return { bundle, warnings }
}

/**
 * Import a replay bundle with full validation
 */
export async function importReplayBundle(
  filePath: string,
  options?: ReplayOptions
): Promise<ReplayImportResult> {
  const errors: string[] = []
  const warnings: string[] = []

  try {
    // Load the replay bundle
    const replay = await loadReplayBundle(filePath)

    // Convert to JobRequestBundle
    const { bundle, warnings: conversionWarnings } = convertReplayToBundle(replay, options)
    warnings.push(...conversionWarnings)

    // Validate the resulting bundle
    const validationResult = JobRequestBundleSchema.safeParse(bundle)
    if (!validationResult.success) {
      errors.push(
        ...validationResult.error.errors.map(
          (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
        )
      )
      return {
        success: false,
        errors,
        warnings,
      }
    }

    return {
      success: true,
      replay_id: replay.replay_id,
      bundle: validationResult.data,
      errors,
      warnings,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      success: false,
      errors,
      warnings,
    }
  }
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Create a replay bundle from a job run
 */
export function createReplayBundle(
  runId: string,
  tenantId: string,
  jobType: string,
  payload: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
  options?: {
    capturedBy?: string
    captureReason?: string
    sourceEnvironment?: string
    tags?: string[]
    projectId?: string
  }
): JobReplayBundle {
  return {
    version: '1.0',
    replay_id: `replay-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    original_run_id: runId,
    captured_at: new Date().toISOString(),
    tenant_id: tenantId,
    project_id: options?.projectId,
    job_type: jobType,
    payload,
    result,
    metadata: {
      captured_by: options?.capturedBy,
      capture_reason: options?.captureReason,
      source_environment: options?.sourceEnvironment,
      tags: options?.tags,
    },
  }
}

/**
 * Save a replay bundle to a file
 */
export async function saveReplayBundle(
  replay: JobReplayBundle,
  outputDir: string,
  fileName?: string
): Promise<string> {
  const finalFileName =
    fileName || `replay-${replay.original_run_id.slice(0, 8)}-${Date.now()}.json`
  const filePath = path.join(outputDir, finalFileName)

  await fs.mkdir(outputDir, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(replay, null, 2))

  return filePath
}

// ============================================================================
// Batch Operations
// ============================================================================

export interface BatchImportResult {
  total: number
  successful: number
  failed: number
  results: ReplayImportResult[]
}

/**
 * Import multiple replay bundles from a directory
 */
export async function batchImportReplayBundles(
  directoryPath: string,
  options?: ReplayOptions
): Promise<BatchImportResult> {
  const files = await fs.readdir(directoryPath)
  const jsonFiles = files.filter((f) => f.endsWith('.json'))

  const results: ReplayImportResult[] = []

  for (const file of jsonFiles) {
    const filePath = path.join(directoryPath, file)
    const result = await importReplayBundle(filePath, options)
    results.push(result)
  }

  return {
    total: jsonFiles.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  }
}

// ============================================================================
// CLI Helpers
// ============================================================================

/**
 * Format replay import result for CLI output
 */
export function formatReplayImportResult(result: ReplayImportResult): string {
  const lines: string[] = []

  if (result.success) {
    lines.push(`✓ Successfully imported replay: ${result.replay_id}`)
    if (result.bundle) {
      lines.push(`  Bundle ID: ${result.bundle.bundle_id}`)
      lines.push(`  Requests: ${result.bundle.requests.length}`)
      lines.push(`  Tenant: ${result.bundle.tenant_id}`)
    }
  } else {
    lines.push(`✗ Failed to import replay`)
  }

  if (result.warnings.length > 0) {
    lines.push('  Warnings:')
    for (const warning of result.warnings) {
      lines.push(`    - ${warning}`)
    }
  }

  if (result.errors.length > 0) {
    lines.push('  Errors:')
    for (const error of result.errors) {
      lines.push(`    - ${error}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format batch import result for CLI output
 */
export function formatBatchImportResult(result: BatchImportResult): string {
  const lines: string[] = []
  lines.push('')
  lines.push('='.repeat(60))
  lines.push(`Batch Import Results`)
  lines.push('='.repeat(60))
  lines.push(`Total: ${result.total}`)
  lines.push(`Successful: ${result.successful}`)
  lines.push(`Failed: ${result.failed}`)
  lines.push('')

  for (const importResult of result.results) {
    lines.push(formatReplayImportResult(importResult))
    lines.push('')
  }

  lines.push('='.repeat(60))
  return lines.join('\n')
}
