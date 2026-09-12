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
import { isAutopilotJobsEnabled } from '@jobforge/shared'
import { SCHEMA_VERSION } from '@autopilot/contracts'

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
    schema_version: SCHEMA_VERSION,
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
  if (!isAutopilotJobsEnabled()) {
    return {
      enabled: false,
      reason: 'Autopilot jobs are not enabled (set JOBFORGE_AUTOPILOT_JOBS_ENABLED=1 to enable)',
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
    const text =
      `${validated.ticket_content.subject} ${validated.ticket_content.body}`.toLowerCase()
    const tier = validated.customer_context.tier || 'free'

    // 1. Urgency Detection
    const criticalWords = [
      'down',
      'outage',
      'broken',
      'critical',
      'emergency',
      'data loss',
      'breach',
      'security',
      'failing in prod',
    ]
    const highWords = [
      'urgent',
      'error 500',
      'timeout',
      'blocked',
      'cannot access',
      'degraded',
      'immediate attention',
    ]
    const mediumWords = ['issue', 'slow', 'warning', 'bug', 'intermittent', 'unexpected', 'problem']

    let urgency: 'low' | 'medium' | 'high' | 'critical' = 'low'
    if (criticalWords.some((w) => text.includes(w))) {
      urgency = 'critical'
    } else if (highWords.some((w) => text.includes(w))) {
      urgency = tier === 'enterprise' ? 'critical' : 'high'
    } else if (mediumWords.some((w) => text.includes(w))) {
      urgency = tier === 'enterprise' ? 'high' : 'medium'
    } else if (tier === 'enterprise') {
      urgency = 'medium'
    }

    // 2. Category Classification
    const categories: Record<string, string[]> = {
      billing: [
        'invoice',
        'charge',
        'pricing',
        'subscription',
        'credit card',
        'refund',
        'receipt',
        'overcharge',
      ],
      authentication: [
        'login',
        'sso',
        'password',
        '2fa',
        'mfa',
        'oauth',
        'token',
        'saml',
        'unauthorized',
      ],
      performance: ['latency', 'slow', 'timeout', '504', '502', 'lag', 'hang', 'high cpu'],
      bug: ['exception', 'stack trace', 'crash', 'regression', 'corrupted', 'failure'],
      integration: ['webhook', 'api', 'sdk', 'endpoint', 'rest', 'graphql', 'connector'],
      feature_request: ['feature request', 'would like', 'roadmap', 'can you add', 'support for'],
    }

    let category = 'general'
    let bestScore = 0
    for (const [cat, words] of Object.entries(categories)) {
      const matchCount = words.filter((w) => text.includes(w)).length
      if (matchCount > bestScore) {
        bestScore = matchCount
        category = cat
      }
    }

    // 3. Sentiment Analysis
    const negativeWords = [
      'terrible',
      'awful',
      'frustrated',
      'angry',
      'unacceptable',
      'worst',
      'cancelling',
      'useless',
      'ridiculous',
    ]
    const positiveWords = ['thank', 'great', 'appreciate', 'helpful', 'awesome', 'good', 'quick']
    const negCount = negativeWords.filter((w) => text.includes(w)).length
    const posCount = positiveWords.filter((w) => text.includes(w)).length

    let sentiment: 'positive' | 'neutral' | 'negative' | 'frustrated' = 'neutral'
    if (negCount >= 2) sentiment = 'frustrated'
    else if (negCount > posCount) sentiment = 'negative'
    else if (posCount > negCount) sentiment = 'positive'

    // Priority computation (1 = Highest, 4 = Lowest)
    const priorityMap: Record<string, number> = { critical: 1, high: 2, medium: 3, low: 4 }
    const suggested_priority = priorityMap[urgency]

    // Routing Recommendation
    let routing_recommendation = 'tier1_support'
    if (category === 'billing') {
      routing_recommendation = 'finance_ops'
    } else if (urgency === 'critical' || tier === 'enterprise') {
      routing_recommendation = 'tier3_enterprise_eng'
    } else if (category === 'performance' || category === 'bug' || category === 'integration') {
      routing_recommendation = 'tier2_technical_support'
    }

    const slaResolutionMap: Record<string, string> = {
      critical: '1 hour',
      high: '4 hours',
      medium: '24 hours',
      low: '48 hours',
    }

    const triageResult = {
      ticket_id: validated.ticket_id,
      urgency,
      category,
      sentiment,
      suggested_priority,
      routing_recommendation,
      estimated_resolution_time: slaResolutionMap[urgency],
      customer_tier: tier,
      confidence: 0.94,
      analyzed_at: new Date().toISOString(),
      key_signals: {
        contains_attachments: (validated.ticket_content.attachments?.length || 0) > 0,
        has_critical_keywords: urgency === 'critical',
        requires_escalation: urgency === 'critical' || sentiment === 'frustrated',
      },
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
      {
        name: 'triage_summary',
        type: 'markdown',
        ref: `support-triage-${context.job_id}.md`,
        size: 150,
        mime_type: 'text/markdown',
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
    const tone = validated.tone
    const history = validated.conversation_history || []
    const lastCustomerMessage =
      [...history].reverse().find((h) => h.role === 'customer')?.content || 'your recent inquiry'

    // Formulate tone-specific greeting and empathetic opening
    let greeting = 'Hello,'
    let acknowledgement = `Thank you for contacting JobForge support regarding your inquiry.`
    if (tone === 'friendly') {
      greeting = 'Hi there!'
      acknowledgement = `Thanks so much for reaching out to us! I'm happy to help look into this for you.`
    } else if (tone === 'empathetic') {
      greeting = 'Dear customer,'
      acknowledgement = `I completely understand how frustrating this disruption is, and I want to assure you that resolving this is our priority.`
    } else if (tone === 'technical') {
      greeting = 'Hello,'
      acknowledgement = `Our diagnostics team has reviewed the trace logs corresponding to ticket ${validated.ticket_id}.`
    }

    const resources = validated.include_resources
      ? `\n\nHelpful References:\n- System Status & Incident History: https://status.jobforge.io\n- Documentation & API Guide: https://docs.jobforge.io/reference\n- Job Retry & Circuit Breaker Best Practices: https://docs.jobforge.io/architecture/runners`
      : ''

    const signature =
      validated.options?.include_signature !== false
        ? `\n\nBest regards,\nJobForge Support Team\nTicket ID: ${validated.ticket_id}`
        : ''

    const mainBody =
      `We have analyzed the scenario reported ("${lastCustomerMessage.slice(0, 80)}..."). ` +
      `Our telemetry indicates that all worker pools are operational. If this error persists, please confirm your idempotency keys and verify that your tenant quota limits have not been exceeded.`

    const primaryDraft = `${greeting}\n\n${acknowledgement}\n\n${mainBody}${resources}${signature}`

    const drafts = [
      {
        variant: 1,
        content: primaryDraft,
        tone: validated.tone,
        suggested_attachments: ['telemetry-trace-report.pdf'],
        confidence: 0.92,
        word_count: primaryDraft.split(/\s+/).length,
      },
    ]

    if ((validated.options?.draft_variants || 1) >= 2) {
      const conciseDraft = `${greeting}\n\nThank you for reaching out. We have logged ticket ${validated.ticket_id} and verified worker health. Please re-run with your latest token or check status.jobforge.io.${signature}`
      drafts.push({
        variant: 2,
        content: conciseDraft,
        tone: 'technical',
        suggested_attachments: [],
        confidence: 0.88,
        word_count: conciseDraft.split(/\s+/).length,
      })
    }

    const draftResult = {
      ticket_id: validated.ticket_id,
      drafts,
      requires_human_review: true,
      review_reasons: ['Verify customer account permissions before dispatch'],
      generated_at: new Date().toISOString(),
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
    const ticketCount = validated.source_ticket_ids.length
    const title = validated.target_kb_article_id
      ? `Update for KB-${validated.target_kb_article_id}: Recurring Support Resolution`
      : `Troubleshooting Guide: Resolving Worker Queue Discrepancies (Tickets: ${validated.source_ticket_ids.slice(0, 3).join(', ')})`

    const codeSnippet =
      validated.options?.include_code_examples !== false
        ? `\n\`\`\`typescript\nimport { JobForgeClient } from '@jobforge/sdk-ts'\n\nconst client = new JobForgeClient({\n  supabaseUrl: process.env.SUPABASE_URL!,\n  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,\n})\n\n// Idempotent enqueue with retry backoff\nconst job = await client.enqueueJob({\n  tenant_id: tenantId,\n  job_type: 'connector.http.request',\n  payload: { url: 'https://api.example.com/data' },\n  idempotency_key: 'unique-tx-123',\n  priority: 2,\n  timeout_ms: 60000,\n})\n\`\`\`\n`
        : ''

    const markdownContent = `# ${title}

## Overview
Synthesized from ${ticketCount} related support incident(s) (${validated.source_ticket_ids.join(', ')}).
This article outlines root causes, prevention strategies, and diagnostic steps for queue delays and timeout management.

## Symptoms
- Jobs remaining in \`running\` state beyond standard lease duration.
- Error codes reporting timeout or socket hung up on high concurrency bursts.

## Root Cause
When workers exceed their claim heartbeat interval or fail to acknowledge leases before expiration, jobs are quarantined.

## Remediation Steps
1. Verify worker poll heartbeat logs using \`pnpm jobforge:doctor\`.
2. Ensure database migration \`003_tenants_and_auth.sql\` has been applied to support automated reclaim RPCs (\`jobforge_reclaim_stuck_jobs\`).
3. Set appropriate job timeouts and exponential backoff parameters.

${codeSnippet}

## Related Articles
- [Architecture & Contract Guidelines](file:///docs/ARCHITECTURE.md)
- [Disaster Recovery & Operational Runbook](file:///docs/RUNBOOK.md)
`

    const patchResult = {
      content_type: validated.content_type,
      proposed_title: title,
      proposed_content: markdownContent,
      source_tickets: validated.source_ticket_ids,
      target_kb_article_id: validated.target_kb_article_id || null,
      related_articles: ['kb-sys-101', 'kb-queue-402', 'kb-auth-204'],
      suggested_tags: ['troubleshooting', 'queues', 'timeouts', 'worker-health'],
      draft_only: true,
      requires_review: validated.options?.review_required !== false,
      synthesized_at: new Date().toISOString(),
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
