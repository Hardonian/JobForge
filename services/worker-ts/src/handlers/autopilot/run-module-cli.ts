/**
 * JobForge Autopilot Module Runner (CLI)
 *
 * Job Type: jobforge.autopilot.run_module_cli
 *
 * Executes a runnerless module in dry-run mode by default, producing:
 * - Report envelope
 * - Request bundle
 * - Pipeline manifest
 * - Optional bundle execution (dry run or execute)
 */

import { z } from 'zod'
import { randomUUID } from 'crypto'
import type { JobContext } from '@jobforge/shared'
import type { ArtifactManifest, ArtifactOutput } from '@jobforge/shared'
import {
  isAutopilotJobsEnabled,
  isModuleRunnerEnabled,
  isBundleExecutorEnabled,
  isTriggerRuleAllowed,
  isActionJob,
} from '@jobforge/shared'
import {
  EventEnvelopeSchema,
  SCHEMA_VERSION,
  type JobRequestBundle,
  type ReportEnvelope,
} from '@autopilot/contracts'
import { executeRequestBundleHandler } from './execute-bundle'

// ============================================================================
// Schemas
// ============================================================================

export const RunModuleCliPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid(),
  event: EventEnvelopeSchema,
  module_id: z.string().min(1).optional(),
  rule: z.object({
    rule_id: z.string().uuid(),
    name: z.string().min(1),
    action_mode: z.enum(['dry_run', 'execute']),
    safety_allow_action_jobs: z.boolean(),
    enabled: z.boolean(),
  }),
  mode: z.enum(['dry_run', 'execute']).optional(),
  bundle_ref: z.string().optional(),
  policy_token: z.string().optional(),
})

export type RunModuleCliPayload = z.infer<typeof RunModuleCliPayloadSchema>

// ============================================================================
// Output Types
// ============================================================================

interface PipelineManifest {
  schema_version: string
  pipeline_version: '1.0'
  generated_at: string
  event_ids: string[]
  module_run_id: string
  bundle_run_id?: string
  child_run_ids: string[]
  status: 'blocked' | 'dry_run' | 'executed'
  rule_id: string
  reason?: string
}

export interface RunModuleCliResult {
  success: boolean
  module_run_id: string
  report?: ReportEnvelope
  request_bundle?: JobRequestBundle
  bundle_run_id?: string
  child_runs?: Array<{ request_id: string; job_id?: string }>
  manifest: ArtifactManifest
  pipeline_manifest: PipelineManifest
  bundle_execution?: {
    bundle_manifest_ref: string
    dry_run: boolean
    child_runs: Array<{ request_id: string; job_id?: string }>
  }
  data?: {
    disabled?: boolean
    reason?: string
  }
}

// ============================================================================
// Helpers
// ============================================================================

function checkModuleRunnerEnabled(): { enabled: true } | { enabled: false; reason: string } {
  if (!isAutopilotJobsEnabled()) {
    return {
      enabled: false,
      reason: 'Autopilot jobs are not enabled (set JOBFORGE_AUTOPILOT_JOBS_ENABLED=1 to enable)',
    }
  }

  if (!isModuleRunnerEnabled()) {
    return {
      enabled: false,
      reason: 'Module runner is disabled (set JOBFORGE_MODULE_RUNNER_ENABLED=1 to enable)',
    }
  }

  return { enabled: true }
}

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
    job_type: 'jobforge.autopilot.run_module_cli',
    created_at: new Date().toISOString(),
    outputs,
    metrics,
    env_fingerprint: generateEnvFingerprint(),
    tool_versions: generateToolVersions(),
    status,
    error,
  }
}

function toStableId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
}

function resolveModuleJobType(moduleId: string): string {
  const normalized = moduleId.trim()

  if (normalized.startsWith('autopilot.')) {
    return normalized
  }

  switch (normalized) {
    case 'ops':
      return 'autopilot.ops.scan'
    case 'support':
      return 'autopilot.support.triage'
    case 'growth':
      return 'autopilot.growth.seo_scan'
    case 'finops':
      return 'autopilot.finops.anomaly_scan'
    default:
      return 'autopilot.ops.scan'
  }
}

function buildReportEnvelope(
  context: JobContext,
  payload: RunModuleCliPayload,
  moduleId: string
): ReportEnvelope {
  return {
    schema_version: SCHEMA_VERSION,
    report_id: `report-${context.job_id}`,
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    trace_id: payload.event.trace_id,
    module_id: (payload.event.source_module || 'ops') as ReportEnvelope['module_id'],
    report_type: moduleId,
    created_at: new Date().toISOString(),
    summary: {
      event_type: payload.event.event_type,
      mode: payload.mode || payload.rule.action_mode,
    },
    payload: {
      event: payload.event,
      module_id: moduleId,
      rule_id: payload.rule.rule_id,
    },
    redaction_hints: payload.event.redaction_hints,
  }
}

function buildRequestBundle(
  context: JobContext,
  payload: RunModuleCliPayload,
  moduleJobType: string
): JobRequestBundle {
  const bundleId = `pipeline-${toStableId(payload.event.trace_id) || context.job_id}`
  const requestId = `module-${toStableId(moduleJobType) || 'autopilot'}-${toStableId(
    payload.event.trace_id
  )}`
  const idempotencyKey = `${payload.rule.rule_id}:${payload.event.trace_id}:${moduleJobType}`

  const actionJob = isActionJob(moduleJobType)

  return {
    schema_version: SCHEMA_VERSION,
    bundle_id: bundleId,
    tenant_id: payload.tenant_id,
    project_id: payload.project_id,
    trace_id: payload.event.trace_id,
    requests: [
      {
        id: requestId,
        job_type: moduleJobType,
        tenant_id: payload.tenant_id,
        project_id: payload.project_id,
        payload: {
          tenant_id: payload.tenant_id,
          project_id: payload.project_id,
          trigger_event_type: payload.event.event_type,
          trigger_trace_id: payload.event.trace_id,
          module_id: moduleJobType,
        },
        idempotency_key: idempotencyKey,
        required_scopes: actionJob ? ['ops:write'] : ['ops:read'],
        is_action_job: actionJob,
      },
    ],
    metadata: {
      source: 'pipeline-trigger',
      triggered_at: new Date().toISOString(),
      correlation_id: `pipeline-${payload.rule.rule_id}`,
    },
  }
}

function buildPipelineManifest(options: {
  eventIds: string[]
  moduleRunId: string
  ruleId: string
  status: PipelineManifest['status']
  bundleRunId?: string
  childRunIds?: string[]
  reason?: string
}): PipelineManifest {
  return {
    schema_version: SCHEMA_VERSION,
    pipeline_version: '1.0',
    generated_at: new Date().toISOString(),
    event_ids: options.eventIds,
    module_run_id: options.moduleRunId,
    bundle_run_id: options.bundleRunId,
    child_run_ids: options.childRunIds || [],
    status: options.status,
    rule_id: options.ruleId,
    reason: options.reason,
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function runModuleCliHandler(
  payload: unknown,
  context: JobContext
): Promise<RunModuleCliResult> {
  const startTime = Date.now()

  const flagCheck = checkModuleRunnerEnabled()
  if (!flagCheck.enabled) {
    const disabledPayload = RunModuleCliPayloadSchema.safeParse(payload)
    const pipelineManifest = buildPipelineManifest({
      eventIds: [context.trace_id],
      moduleRunId: context.job_id,
      ruleId: disabledPayload.success ? disabledPayload.data.rule.rule_id : randomUUID(),
      status: 'blocked',
      reason: flagCheck.reason,
    })

    const pipelineOutput: ArtifactOutput = {
      name: 'pipeline_manifest',
      type: 'json',
      ref: `pipeline-manifest-${context.job_id}.json`,
      size: JSON.stringify(pipelineManifest).length,
      mime_type: 'application/json',
    }

    const manifest = createManifest(
      context,
      'failed',
      [pipelineOutput],
      { duration_ms: 0 },
      { message: flagCheck.reason, code: 'FEATURE_FLAG_DISABLED' }
    )

    return {
      success: false,
      module_run_id: context.job_id,
      manifest,
      pipeline_manifest: pipelineManifest,
      data: { disabled: true, reason: flagCheck.reason },
    }
  }

  const validated = RunModuleCliPayloadSchema.parse(payload)
  const moduleId = validated.module_id || validated.event.source_module || 'autopilot.ops.scan'
  const moduleJobType = resolveModuleJobType(moduleId)
  const requestedMode = validated.mode || validated.rule.action_mode

  const report = buildReportEnvelope(context, validated, moduleJobType)
  const requestBundle = buildRequestBundle(context, validated, moduleJobType)

  const outputs: ArtifactOutput[] = []
  outputs.push({
    name: 'module_report',
    type: 'json',
    ref: `module-report-${context.job_id}.json`,
    size: JSON.stringify(report).length,
    mime_type: 'application/json',
  })
  outputs.push({
    name: 'request_bundle',
    type: 'json',
    ref: `request-bundle-${context.job_id}.json`,
    size: JSON.stringify(requestBundle).length,
    mime_type: 'application/json',
  })

  let bundleRunId: string | undefined
  let childRuns: Array<{ request_id: string; job_id?: string }> = []
  let bundleExecution: RunModuleCliResult['bundle_execution']
  let pipelineStatus: PipelineManifest['status'] = 'dry_run'
  let pipelineReason: string | undefined

  const ruleDecision = isTriggerRuleAllowed({
    action_mode: requestedMode,
    safety_allow_action_jobs: validated.rule.safety_allow_action_jobs,
    enabled: validated.rule.enabled,
  })

  if (!ruleDecision.allowed) {
    pipelineStatus = 'blocked'
    pipelineReason = ruleDecision.reason
  } else if (requestedMode === 'execute' && !isBundleExecutorEnabled()) {
    pipelineStatus = 'blocked'
    pipelineReason = 'Bundle executor is disabled (set JOBFORGE_BUNDLE_EXECUTOR_ENABLED=1 to enable)'
  }

  if (isBundleExecutorEnabled() && pipelineStatus !== 'blocked') {
    const bundleContext: JobContext = {
      job_id: randomUUID(),
      tenant_id: validated.tenant_id,
      attempt_no: 1,
      trace_id: context.trace_id,
      heartbeat: async () => {},
    }

    const executionMode = requestedMode === 'execute' ? 'execute' : 'dry_run'
    const bundleResult = await executeRequestBundleHandler(
      {
        tenant_id: validated.tenant_id,
        project_id: validated.project_id,
        trace_id: validated.event.trace_id,
        request_bundle: requestBundle,
        mode: executionMode,
        policy_token: validated.policy_token,
      },
      bundleContext
    )

    bundleRunId = bundleResult.bundle_run_id
    childRuns = (bundleResult.child_runs || []).map((run) => ({
      request_id: run.request_id,
      job_id: run.job_id,
    }))

    bundleExecution = {
      bundle_manifest_ref: bundleResult.bundle_manifest_ref,
      dry_run: bundleResult.dry_run ?? executionMode === 'dry_run',
      child_runs: childRuns,
    }

    outputs.push({
      name: 'bundle_manifest',
      type: 'json',
      ref: bundleResult.bundle_manifest_ref,
      mime_type: 'application/json',
    })

    pipelineStatus = executionMode === 'execute' ? 'executed' : 'dry_run'
  }

  const pipelineManifest = buildPipelineManifest({
    eventIds: [validated.event.trace_id],
    moduleRunId: context.job_id,
    ruleId: validated.rule.rule_id,
    status: pipelineStatus,
    bundleRunId,
    childRunIds: childRuns.map((run) => run.job_id).filter((id): id is string => Boolean(id)),
    reason: pipelineReason,
  })

  outputs.push({
    name: 'pipeline_manifest',
    type: 'json',
    ref: `pipeline-manifest-${context.job_id}.json`,
    size: JSON.stringify(pipelineManifest).length,
    mime_type: 'application/json',
  })

  const manifest = createManifest(
    context,
    pipelineStatus === 'blocked' ? 'failed' : 'complete',
    outputs,
    { duration_ms: Date.now() - startTime },
    pipelineStatus === 'blocked' ? { message: pipelineReason } : undefined
  )

  return {
    success: pipelineStatus !== 'blocked',
    module_run_id: context.job_id,
    report,
    request_bundle: requestBundle,
    bundle_run_id: bundleRunId,
    child_runs: childRuns,
    manifest,
    pipeline_manifest: pipelineManifest,
    bundle_execution: bundleExecution,
  }
}
