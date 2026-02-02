/**
 * Autopilot Support Job Handlers
 * Support automation jobs: triage, draft reply, propose KB patch
 *
 * Job Types:
 * - autopilot.support.triage
 * - autopilot.support.draft_reply
 * - autopilot.support.propose_kb_patch
 */

import { z } from 'zod'
import type { JobContext } from '@jobforge/shared'
import type { ArtifactManifest, ArtifactOutput } from '@jobforge/shared'
import { JOBFORGE_AUTOPILOT_JOBS_ENABLED } from '@jobforge/shared'

// ============================================================================
// Shared Types & Helpers
// ============================================================================

interface AutopilotResult {
  success: boolean
  manifest: ArtifactManifest
  artifact_ref?: string
  data?: Record<string, unknown>
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
  jobType: string,
  status: 'pending' | 'complete' | 'failed',
  outputs: ArtifactOutput[],
  metrics: Record<string, number>,
  error?: Record<string, unknown>
): ArtifactManifest {
  return {
    manifest_version: '1.0',
    run_id: context.job_id,
    tenant_id: context.tenant_id,
    job_type: jobType,
    created_at: new Date().toISOString(),
    outputs,
    metrics,
    env_fingerprint: generateEnvFingerprint(),
    tool_versions: generateToolVersions(),
    status,
    error,
  }
}

function checkAutopilotEnabled(): { enabled: true } | { enabled: false; reason: string } {
  if (!JOBFORGE_AUTOPILOT_JOBS_ENABLED) {
    return {
      enabled: false,
      reason: 'JOBFORGE_AUTOPILOT_JOBS_ENABLED is not enabled (set to 1 to enable)',
    }
  }
  return { enabled: true }
}

function createDisabledResult(
  context: JobContext,
  jobType: string,
  reason: string
): AutopilotResult {
  const outputs: ArtifactOutput[] = []
  const manifest = createManifest(
    context,
    jobType,
    'failed',
    outputs,
    { duration_ms: 0 },
    { message: reason, code: 'FEATURE_FLAG_DISABLED' }
  )

  return {
    success: false,
    manifest,
    data: { disabled: true, reason },
  }
}

// ============================================================================
// autopilot.support.triage - Ticket Triage
// ============================================================================

export const SupportTriagePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  ticket_id: z.string(),
  ticket_content: z.object({
    subject: z.string(),
    body: z.string(),
    attachments: z
      .array(
        z.object({
          name: z.string(),
          content_type: z.string(),
          size: z.number(),
        })
      )
      .optional(),
  }),
  customer_context: z.object({
    customer_id: z.string(),
    tier: z.enum(['free', 'starter', 'pro', 'enterprise']).optional(),
    history_summary: z.string().optional(),
  }),
  options: z
    .object({
      urgency_detection: z.boolean().default(true),
      category_classification: z.boolean().default(true),
      sentiment_analysis: z.boolean().default(true),
    })
    .optional(),
})

export type SupportTriagePayload = z.infer<typeof SupportTriagePayloadSchema>

export async function supportTriageHandler(
  payload: unknown,
  context: JobContext
): Promise<AutopilotResult> {
  const startTime = Date.now()

  const flagCheck = checkAutopilotEnabled()
  if (!flagCheck.enabled) {
    return createDisabledResult(context, 'autopilot.support.triage', flagCheck.reason)
  }

  try {
    const validated = SupportTriagePayloadSchema.parse(payload)

    // TODO: Implement actual triage logic (stubbed)
    const triageResult = {
      ticket_id: validated.ticket_id,
      urgency: 'medium',
      category: 'general',
      sentiment: 'neutral',
      suggested_priority: 3,
      routing_recommendation: 'default_queue',
      estimated_resolution_time: 'unknown',
    }

    const durationMs = Date.now() - startTime
    const outputs: ArtifactOutput[] = [
      {
        name: 'triage_result',
        type: 'json',
        ref: `support-triage-${context.job_id}.json`,
        size: JSON.stringify(triageResult).length,
        mime_type: 'application/json',
      },
    ]

    const manifest = createManifest(context, 'autopilot.support.triage', 'complete', outputs, {
      duration_ms: durationMs,
    })

    return {
      success: true,
      manifest,
      artifact_ref: outputs[0].ref,
      data: triageResult,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const manifest = createManifest(
      context,
      'autopilot.support.triage',
      'failed',
      [],
      { duration_ms: Date.now() - startTime },
      { message: errorMessage }
    )

    return {
      success: false,
      manifest,
      data: { error: errorMessage },
    }
  }
}

// ============================================================================
// autopilot.support.draft_reply - Draft Support Reply
// ============================================================================

export const SupportDraftReplyPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  ticket_id: z.string(),
  conversation_history: z
    .array(
      z.object({
        role: z.enum(['customer', 'agent', 'system']),
        content: z.string(),
        timestamp: z.string().datetime(),
      })
    )
    .optional(),
  tone: z.enum(['professional', 'friendly', 'empathetic', 'technical']).default('professional'),
  include_resources: z.boolean().default(true),
  options: z
    .object({
      max_length: z.number().int().min(50).max(5000).default(1000),
      include_signature: z.boolean().default(true),
      draft_variants: z.number().int().min(1).max(3).default(1),
    })
    .optional(),
})

export type SupportDraftReplyPayload = z.infer<typeof SupportDraftReplyPayloadSchema>

export async function supportDraftReplyHandler(
  payload: unknown,
  context: JobContext
): Promise<AutopilotResult> {
  const startTime = Date.now()

  const flagCheck = checkAutopilotEnabled()
  if (!flagCheck.enabled) {
    return createDisabledResult(context, 'autopilot.support.draft_reply', flagCheck.reason)
  }

  try {
    const validated = SupportDraftReplyPayloadSchema.parse(payload)

    // TODO: Implement actual draft reply logic (stubbed)
    const draftResult = {
      ticket_id: validated.ticket_id,
      drafts: [
        {
          variant: 1,
          content: 'Draft reply not yet implemented - stub result',
          tone: validated.tone,
          suggested_attachments: [],
          confidence: 0.0,
        },
      ],
      requires_human_review: true,
    }

    const durationMs = Date.now() - startTime
    const outputs: ArtifactOutput[] = [
      {
        name: 'draft_reply',
        type: 'json',
        ref: `support-draft-${context.job_id}.json`,
        size: JSON.stringify(draftResult).length,
        mime_type: 'application/json',
      },
    ]

    const manifest = createManifest(context, 'autopilot.support.draft_reply', 'complete', outputs, {
      duration_ms: durationMs,
    })

    return {
      success: true,
      manifest,
      artifact_ref: outputs[0].ref,
      data: draftResult,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const manifest = createManifest(
      context,
      'autopilot.support.draft_reply',
      'failed',
      [],
      { duration_ms: Date.now() - startTime },
      { message: errorMessage }
    )

    return {
      success: false,
      manifest,
      data: { error: errorMessage },
    }
  }
}

// ============================================================================
// autopilot.support.propose_kb_patch - Propose KB Article Patch
// ============================================================================

export const SupportProposeKbPatchPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  source_ticket_ids: z.array(z.string()).min(1),
  target_kb_article_id: z.string().optional(),
  content_type: z.enum(['new_article', 'section_update', 'faq_entry']).default('new_article'),
  options: z
    .object({
      include_code_examples: z.boolean().default(true),
      review_required: z.boolean().default(true),
      auto_link_related: z.boolean().default(true),
    })
    .optional(),
})

export type SupportProposeKbPatchPayload = z.infer<typeof SupportProposeKbPatchPayloadSchema>

export async function supportProposeKbPatchHandler(
  payload: unknown,
  context: JobContext
): Promise<AutopilotResult> {
  const startTime = Date.now()

  const flagCheck = checkAutopilotEnabled()
  if (!flagCheck.enabled) {
    return createDisabledResult(context, 'autopilot.support.propose_kb_patch', flagCheck.reason)
  }

  try {
    const validated = SupportProposeKbPatchPayloadSchema.parse(payload)

    // TODO: Implement actual KB patch logic (stubbed)
    // This is draft-only - no actual KB modifications
    const patchResult = {
      content_type: validated.content_type,
      proposed_title: 'Proposed KB Update (Draft)',
      proposed_content: 'KB content not yet implemented - stub result',
      related_articles: [],
      suggested_tags: [],
      draft_only: true,
      requires_review: true,
    }

    const durationMs = Date.now() - startTime
    const outputs: ArtifactOutput[] = [
      {
        name: 'kb_patch_proposal',
        type: 'json',
        ref: `support-kb-patch-${context.job_id}.json`,
        size: JSON.stringify(patchResult).length,
        mime_type: 'application/json',
      },
      {
        name: 'kb_patch_markdown',
        type: 'markdown',
        ref: `support-kb-patch-${context.job_id}.md`,
        size: patchResult.proposed_content.length,
        mime_type: 'text/markdown',
      },
    ]

    const manifest = createManifest(
      context,
      'autopilot.support.propose_kb_patch',
      'complete',
      outputs,
      { duration_ms: durationMs }
    )

    return {
      success: true,
      manifest,
      artifact_ref: outputs[0].ref,
      data: patchResult,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    const manifest = createManifest(
      context,
      'autopilot.support.propose_kb_patch',
      'failed',
      [],
      { duration_ms: Date.now() - startTime },
      { message: errorMessage }
    )

    return {
      success: false,
      manifest,
      data: { error: errorMessage },
    }
  }
}
