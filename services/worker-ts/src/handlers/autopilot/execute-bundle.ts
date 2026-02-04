/**
 * JobForge Autopilot Execute Request Bundle
 * First-class job type for consuming runnerless module outputs
 *
 * Job Type: jobforge.autopilot.execute_request_bundle
 *
 * This job:
 * - Validates request bundles from @autopilot/contracts
 * - Enforces tenant/project scoping
 * - Handles deduplication
 * - Enforces action job policies
 * - Produces bundle manifests
 */

import { z } from 'zod'
import type { JobContext } from '@jobforge/shared'
import type { ArtifactManifest, ArtifactOutput } from '@jobforge/shared'
import {
  isAutopilotJobsEnabled,
  isActionJobsEnabled,
  JOBFORGE_POLICY_TOKEN_SECRET,
  buildImpactGraphFromBundleRun,
} from '@jobforge/shared'
import {
  JobRequestBundleSchema,
  JobRequestSchema,
  SCHEMA_VERSION,
  type JobRequestBundle,
} from '@autopilot/contracts'

// ============================================================================
// Schemas
// ============================================================================

export { JobRequestSchema, JobRequestBundleSchema }

export const ExecuteRequestBundlePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  trace_id: z.string().min(1),
  request_bundle: JobRequestBundleSchema,
  mode: z.enum(['dry_run', 'execute']),
  policy_token: z.string().optional(),
})

export type ExecuteRequestBundlePayload = z.infer<typeof ExecuteRequestBundlePayloadSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface ChildRunResult {
  request_id: string
  job_type: string
  status: 'accepted' | 'denied' | 'skipped' | 'queued' | 'executed' | 'error'
  reason?: string
  job_id?: string
  error?: string
}

export interface ExecuteBundleResult {
  success: boolean
  bundle_run_id: string
  child_runs: ChildRunResult[]
  bundle_manifest_ref: string
  summary: {
    total: number
    accepted: number
    denied: number
    skipped: number
    queued: number
    executed: number
    errors: number
    action_jobs_blocked: number
  }
  dry_run?: boolean
  manifest: ArtifactManifest
  artifact_ref?: string
}

// ============================================================================
// Feature Flag & Policy Checks
// ============================================================================

function checkAutopilotEnabled(): { enabled: true } | { enabled: false; reason: string } {
  if (!isAutopilotJobsEnabled()) {
    return {
      enabled: false,
      reason: 'Autopilot jobs are not enabled (set JOBFORGE_AUTOPILOT_JOBS_ENABLED=1 to enable)',
    }
  }
  return { enabled: true }
}

function verifyPolicyToken(
  token: string | undefined,
  bundle: JobRequestBundle
): { valid: true } | { valid: false; reason: string } {
  // If no action jobs in bundle, token not required
  const hasActionJobs = bundle.requests.some((r) => r.is_action_job)
  if (!hasActionJobs) {
    return { valid: true }
  }

  // Action jobs require the feature flag
  if (!isActionJobsEnabled()) {
    return {
      valid: false,
      reason: 'Action jobs are disabled (set JOBFORGE_ACTION_JOBS_ENABLED=1 to enable)',
    }
  }

  // Token is required for action jobs
  if (!token) {
    return {
      valid: false,
      reason: 'Policy token required for action jobs but not provided',
    }
  }

  // TODO: Implement proper HMAC verification
  // For now, just check that a secret is configured
  if (!JOBFORGE_POLICY_TOKEN_SECRET) {
    return {
      valid: false,
      reason: 'Policy token secret not configured',
    }
  }

  // Basic token format validation (stub)
  if (token.length < 32) {
    return {
      valid: false,
      reason: 'Invalid policy token format',
    }
  }

  return { valid: true }
}

// ============================================================================
// Helper Functions
// ============================================================================

function generateEnvFingerprint(): Record<string, string> {
  return {
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
  }
}

function generateToolVersions(): Record<string, string | Record<string, string>> {
  return {
    jobforge: '0.2.0',
    connectors: {
      autopilot: '1.0.0',
    },
  }
}

function createManifest(
  context: JobContext,
  status: 'pending' | 'complete' | 'failed',
  outputs: ArtifactOutput[],
  metrics: Record<string, number>,
  error?: Record<string, unknown>
): ArtifactManifest {
  return {
    schema_version: SCHEMA_VERSION,
    manifest_version: '1.0',
    run_id: context.job_id,
    tenant_id: context.tenant_id,
    job_type: 'jobforge.autopilot.execute_request_bundle',
    created_at: new Date().toISOString(),
    outputs,
    metrics,
    env_fingerprint: generateEnvFingerprint(),
    tool_versions: generateToolVersions(),
    status,
    error,
  }
}

// ============================================================================
// Bundle Processing
// ============================================================================

function processBundle(
  bundle: JobRequestBundle,
  payloadTenantId: string,
  payloadProjectId: string | undefined,
  policyTokenValid: boolean,
  mode: 'dry_run' | 'execute'
): { childRuns: ChildRunResult[]; summary: ExecuteBundleResult['summary'] } {
  const childRuns: ChildRunResult[] = []
  const summary: ExecuteBundleResult['summary'] = {
    total: bundle.requests.length,
    accepted: 0,
    denied: 0,
    skipped: 0,
    queued: 0,
    executed: 0,
    errors: 0,
    action_jobs_blocked: 0,
  }

  // Check if bundle has action jobs but policy token is invalid
  const hasActionJobs = bundle.requests.some((r) => r.is_action_job)
  const policyFailure = hasActionJobs && !policyTokenValid

  // Track deduplication keys
  const seenIds = new Set<string>()
  const seenIdempotencyKeys = new Set<string>()

  for (const request of bundle.requests) {
    // Check for duplicate request IDs
    if (seenIds.has(request.id)) {
      childRuns.push({
        request_id: request.id,
        job_type: request.job_type,
        status: 'skipped',
        reason: 'Duplicate request ID in bundle',
      })
      summary.skipped++
      continue
    }
    seenIds.add(request.id)

    // Check for duplicate idempotency keys
    if (request.idempotency_key) {
      if (seenIdempotencyKeys.has(request.idempotency_key)) {
        childRuns.push({
          request_id: request.id,
          job_type: request.job_type,
          status: 'skipped',
          reason: 'Duplicate idempotency key in bundle',
        })
        summary.skipped++
        continue
      }
      seenIdempotencyKeys.add(request.idempotency_key)
    }

    // Validate tenant/project scoping
    if (request.tenant_id !== payloadTenantId) {
      childRuns.push({
        request_id: request.id,
        job_type: request.job_type,
        status: 'denied',
        reason: `Tenant mismatch: expected ${payloadTenantId}, got ${request.tenant_id}`,
      })
      summary.denied++
      continue
    }

    if (payloadProjectId && request.project_id !== payloadProjectId) {
      childRuns.push({
        request_id: request.id,
        job_type: request.job_type,
        status: 'denied',
        reason: `Project mismatch: expected ${payloadProjectId}, got ${request.project_id}`,
      })
      summary.denied++
      continue
    }

    // Check action job policy - deny ALL jobs if policy token invalid and action jobs present
    if (policyFailure) {
      childRuns.push({
        request_id: request.id,
        job_type: request.job_type,
        status: 'denied',
        reason: request.is_action_job
          ? 'Action job blocked: policy token required but invalid/missing'
          : 'Denied due to policy token failure for action jobs in bundle',
      })
      summary.denied++
      if (request.is_action_job) {
        summary.action_jobs_blocked++
      }
      continue
    }

    // In dry_run mode, just record what would happen
    if (mode === 'dry_run') {
      childRuns.push({
        request_id: request.id,
        job_type: request.job_type,
        status: 'accepted',
        reason: 'Would enqueue (dry run)',
      })
      summary.accepted++
      continue
    }

    // In execute mode, we would actually enqueue
    // For now, stub the execution
    // TODO: Integrate with actual job enqueue system
    childRuns.push({
      request_id: request.id,
      job_type: request.job_type,
      status: 'queued',
      job_id: `stub-${request.id}-${Date.now()}`,
      reason: 'Job queued for execution',
    })
    summary.queued++
  }

  return { childRuns, summary }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function executeRequestBundleHandler(
  payload: unknown,
  context: JobContext
): Promise<ExecuteBundleResult> {
  const startTime = Date.now()

  // Check feature flags
  const flagCheck = checkAutopilotEnabled()
  if (!flagCheck.enabled) {
    const manifest = createManifest(
      context,
      'failed',
      [],
      { duration_ms: 0 },
      { message: flagCheck.reason, code: 'FEATURE_FLAG_DISABLED' }
    )

    return {
      success: false,
      bundle_run_id: context.job_id,
      child_runs: [],
      bundle_manifest_ref: `bundle-manifest-${context.job_id}.json`,
      summary: {
        total: 0,
        accepted: 0,
        denied: 0,
        skipped: 0,
        queued: 0,
        executed: 0,
        errors: 1,
        action_jobs_blocked: 0,
      },
      manifest,
    }
  }

  try {
    // Validate payload
    const validated = ExecuteRequestBundlePayloadSchema.parse(payload)
    const bundle = validated.request_bundle

    // Verify policy token if needed
    const policyCheck = verifyPolicyToken(validated.policy_token, bundle)
    const policyTokenValid = policyCheck.valid

    // Process bundle - policy token invalidity is handled per-job in processBundle
    // We still process all jobs, but action jobs will be denied

    // Process the bundle
    const { childRuns, summary } = processBundle(
      bundle,
      validated.tenant_id,
      validated.project_id,
      policyTokenValid,
      validated.mode
    )

    // Calculate success based on results
    const hasErrors = childRuns.some((r) => r.status === 'error')
    const allDenied = childRuns.every((r) => r.status === 'denied')
    const hasBlockedActionJobs = summary.action_jobs_blocked > 0
    const success = !hasErrors && !allDenied && summary.errors === 0 && !hasBlockedActionJobs

    // Create outputs
    const bundleResult = {
      bundle_id: bundle.bundle_id,
      trace_id: bundle.trace_id,
      mode: validated.mode,
      processed_at: new Date().toISOString(),
      child_runs: childRuns,
      summary,
      policy_token_valid: policyTokenValid,
    }

    const outputs: ArtifactOutput[] = [
      {
        name: 'bundle_manifest',
        type: 'json',
        ref: `bundle-manifest-${context.job_id}.json`,
        size: JSON.stringify(bundleResult).length,
        mime_type: 'application/json',
      },
    ]

    // Add summary output
    const summaryMarkdown = `# Bundle Execution Summary

**Bundle ID**: ${bundle.bundle_id}
**Mode**: ${validated.mode}
**Total Requests**: ${summary.total}

## Results
- Accepted: ${summary.accepted}
- Denied: ${summary.denied}
- Skipped: ${summary.skipped}
- Queued: ${summary.queued}
- Errors: ${summary.errors}
- Action Jobs Blocked: ${summary.action_jobs_blocked}

## Child Runs
${childRuns.map((r) => `- **${r.request_id}** (${r.job_type}): ${r.status}${r.reason ? ` - ${r.reason}` : ''}`).join('\n')}
`
    outputs.push({
      name: 'bundle_summary',
      type: 'markdown',
      ref: `bundle-summary-${context.job_id}.md`,
      size: summaryMarkdown.length,
      mime_type: 'text/markdown',
    })

    const impactArtifact: ArtifactOutput = {
      name: 'impact_graph',
      type: 'json',
      ref: `impact-${context.job_id}.json`,
      mime_type: 'application/json',
    }

    const impactGraph = buildImpactGraphFromBundleRun({
      run_id: context.job_id,
      tenant_id: validated.tenant_id,
      project_id: validated.project_id,
      trace_id: validated.trace_id,
      bundle_run: {
        job_type: 'jobforge.autopilot.execute_request_bundle',
        status: success ? 'complete' : 'failed',
        created_at: new Date().toISOString(),
        mode: validated.mode,
      },
      event: {
        id: validated.trace_id,
        type: 'bundle_request',
        source_app:
          typeof bundle.metadata?.source === 'string' ? String(bundle.metadata?.source) : undefined,
        payload: {
          bundle_id: bundle.bundle_id,
        },
      },
      request_bundle: bundle,
      child_runs: childRuns.map((child) => ({
        request_id: child.request_id,
        job_type: child.job_type,
        status: child.status,
        job_id: child.job_id,
        reason: child.reason,
      })),
      artifacts: [...outputs, impactArtifact],
    })

    const impactJson = JSON.stringify(impactGraph, null, 2)
    impactArtifact.size = impactJson.length
    outputs.push(impactArtifact)

    const manifest = createManifest(
      context,
      success ? 'complete' : 'failed',
      outputs,
      { duration_ms: Date.now() - startTime },
      success ? undefined : { message: 'Some child runs failed or were denied' }
    )

    return {
      success,
      bundle_run_id: context.job_id,
      child_runs: childRuns,
      bundle_manifest_ref: outputs[0].ref,
      summary,
      dry_run: validated.mode === 'dry_run',
      manifest,
      artifact_ref: outputs[0].ref,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    const manifest = createManifest(
      context,
      'failed',
      [],
      { duration_ms: Date.now() - startTime },
      {
        message: errorMessage,
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
      }
    )

    return {
      success: false,
      bundle_run_id: context.job_id,
      child_runs: [],
      bundle_manifest_ref: `bundle-manifest-${context.job_id}.json`,
      summary: {
        total: 0,
        accepted: 0,
        denied: 0,
        skipped: 0,
        queued: 0,
        executed: 0,
        errors: 1,
        action_jobs_blocked: 0,
      },
      manifest,
    }
  }
}
