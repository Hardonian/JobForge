/**
 * JobForge Event-Triggered Bundle Execution
 * Integrates event ingestion with bundle trigger evaluation
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  EventEnvelope,
  EventRow,
  BundleTriggerRule,
  TriggerEvaluationReport,
  JobRequestBundle,
  SubmitEventParams,
} from './execution-plane/index.js'
import { isBundleTriggersEnabled, isBundleExecutorEnabled } from './feature-flags.js'
import { evaluateTriggers } from './execution-plane/bundle-triggers.js'

// ============================================================================
// Types
// ============================================================================

export interface EventIngestionResult {
  event: EventRow
  triggers_evaluated: boolean
  evaluation_report?: TriggerEvaluationReport
  bundles_queued: number
  errors: string[]
}

export interface TriggerRuleWithBundle extends BundleTriggerRule {
  resolved_bundle?: JobRequestBundle
}

// ============================================================================
// Event Ingestion with Trigger Evaluation
// ============================================================================

/**
 * Submit an event and evaluate triggers asynchronously
 * This should be called after successfully storing the event
 */
export async function evaluateTriggersForEvent(
  event: EventEnvelope,
  rules: BundleTriggerRule[],
  options?: {
    bundleTriggersEnabled?: boolean
    onBundleFire?: (rule: BundleTriggerRule, event: EventEnvelope) => Promise<void>
  }
): Promise<TriggerEvaluationReport> {
  // Check feature flag
  const enabled = options?.bundleTriggersEnabled ?? isBundleTriggersEnabled()

  if (!enabled) {
    return {
      event_id: event.trace_id,
      evaluated_at: new Date().toISOString(),
      tenant_id: event.tenant_id,
      rules_evaluated: 0,
      rules_matched: 0,
      rules_fired: 0,
      results: [],
    }
  }

  // Run trigger evaluation
  const report = evaluateTriggers(event, rules, {
    bundleTriggersEnabled: enabled,
  })

  // Fire callbacks for matched triggers
  if (options?.onBundleFire) {
    for (const result of report.results) {
      if (result.decision === 'fire') {
        const rule = rules.find((r) => r.rule_id === result.rule_id)
        if (rule) {
          await options.onBundleFire(rule, event)
        }
      }
    }
  }

  return report
}

// ============================================================================
// Database-Backed Trigger Storage
// ============================================================================

export interface TriggerStorage {
  listRules(tenantId: string, projectId?: string): Promise<BundleTriggerRule[]>
  getRule(ruleId: string): Promise<BundleTriggerRule | null>
  createRule(
    rule: Omit<
      BundleTriggerRule,
      'rule_id' | 'created_at' | 'updated_at' | 'fire_count' | 'last_fired_at'
    >
  ): Promise<BundleTriggerRule>
  updateRule(ruleId: string, updates: Partial<BundleTriggerRule>): Promise<BundleTriggerRule | null>
  deleteRule(ruleId: string): Promise<boolean>
  recordEvaluation(eventId: string, ruleId: string, result: unknown): Promise<void>
}

/**
 * Database-backed trigger storage using Supabase
 */
export function createDatabaseTriggerStorage(supabase: SupabaseClient): TriggerStorage {
  return {
    async listRules(tenantId: string, projectId?: string): Promise<BundleTriggerRule[]> {
      const { data, error } = await supabase.rpc('jobforge_list_bundle_trigger_rules', {
        p_tenant_id: tenantId,
        p_project_id: projectId || null,
      })

      if (error) {
        throw new Error(`Failed to list trigger rules: ${error.message}`)
      }

      return (data || []).map((row: Record<string, unknown>) => ({
        rule_id: row.id as string,
        tenant_id: row.tenant_id as string,
        project_id: row.project_id as string | null,
        name: row.name as string,
        enabled: row.enabled as boolean,
        match: {
          event_type_allowlist: row.match_event_type_allowlist as string[],
          source_module_allowlist: row.match_source_module_allowlist as string[] | undefined,
          severity_threshold: row.match_severity_threshold as string | undefined,
          priority_threshold: row.match_priority_threshold as string | undefined,
        },
        action: {
          bundle_source: row.action_bundle_source as 'inline' | 'artifact_ref',
          bundle_ref: row.action_bundle_ref as string | undefined,
          bundle_builder: row.action_bundle_builder as string | undefined,
          mode: row.action_mode as 'dry_run' | 'execute',
        },
        safety: {
          cooldown_seconds: row.safety_cooldown_seconds as number,
          max_runs_per_hour: row.safety_max_runs_per_hour as number,
          dedupe_key_template: row.safety_dedupe_key_template as string | undefined,
          allow_action_jobs: row.safety_allow_action_jobs as boolean,
        },
        created_at: row.created_at as string,
        updated_at: row.updated_at as string,
        last_fired_at: row.last_fired_at as string | null,
        fire_count: row.fire_count as number,
      }))
    },

    async getRule(ruleId: string): Promise<BundleTriggerRule | null> {
      const { data, error } = await supabase
        .from('jobforge_bundle_trigger_rules')
        .select('*')
        .eq('id', ruleId)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          return null
        }
        throw new Error(`Failed to get trigger rule: ${error.message}`)
      }

      if (!data) return null

      return {
        rule_id: data.id,
        tenant_id: data.tenant_id,
        project_id: data.project_id,
        name: data.name,
        enabled: data.enabled,
        match: {
          event_type_allowlist: data.match_event_type_allowlist,
          source_module_allowlist: data.match_source_module_allowlist,
          severity_threshold: data.match_severity_threshold,
          priority_threshold: data.match_priority_threshold,
        },
        action: {
          bundle_source: data.action_bundle_source,
          bundle_ref: data.action_bundle_ref,
          bundle_builder: data.action_bundle_builder,
          mode: data.action_mode,
        },
        safety: {
          cooldown_seconds: data.safety_cooldown_seconds,
          max_runs_per_hour: data.safety_max_runs_per_hour,
          dedupe_key_template: data.safety_dedupe_key_template,
          allow_action_jobs: data.safety_allow_action_jobs,
        },
        created_at: data.created_at,
        updated_at: data.updated_at,
        last_fired_at: data.last_fired_at,
        fire_count: data.fire_count,
      }
    },

    async createRule(
      rule: Omit<
        BundleTriggerRule,
        'rule_id' | 'created_at' | 'updated_at' | 'fire_count' | 'last_fired_at'
      >
    ): Promise<BundleTriggerRule> {
      const { data, error } = await supabase.rpc('jobforge_create_bundle_trigger_rule', {
        p_tenant_id: rule.tenant_id,
        p_name: rule.name,
        p_match_event_type_allowlist: rule.match.event_type_allowlist,
        p_action_bundle_source: rule.action.bundle_source,
        p_action_mode: rule.action.mode,
        p_project_id: rule.project_id || null,
        p_match_source_module_allowlist: rule.match.source_module_allowlist || null,
        p_match_severity_threshold: rule.match.severity_threshold || null,
        p_match_priority_threshold: rule.match.priority_threshold || null,
        p_action_bundle_ref: rule.action.bundle_ref || null,
        p_action_bundle_builder: rule.action.bundle_builder || null,
        p_enabled: rule.enabled,
        p_safety_cooldown_seconds: rule.safety.cooldown_seconds,
        p_safety_max_runs_per_hour: rule.safety.max_runs_per_hour,
        p_safety_allow_action_jobs: rule.safety.allow_action_jobs,
      })

      if (error) {
        throw new Error(`Failed to create trigger rule: ${error.message}`)
      }

      return this.getRule(data.id) as Promise<BundleTriggerRule>
    },

    async updateRule(
      ruleId: string,
      updates: Partial<BundleTriggerRule>
    ): Promise<BundleTriggerRule | null> {
      // Build update object
      const updateData: Record<string, unknown> = {}

      if (updates.name !== undefined) updateData.name = updates.name
      if (updates.enabled !== undefined) updateData.enabled = updates.enabled
      if (updates.match !== undefined) {
        updateData.match_event_type_allowlist = updates.match.event_type_allowlist
        updateData.match_source_module_allowlist = updates.match.source_module_allowlist
        updateData.match_severity_threshold = updates.match.severity_threshold
        updateData.match_priority_threshold = updates.match.priority_threshold
      }
      if (updates.action !== undefined) {
        updateData.action_bundle_source = updates.action.bundle_source
        updateData.action_bundle_ref = updates.action.bundle_ref
        updateData.action_bundle_builder = updates.action.bundle_builder
        updateData.action_mode = updates.action.mode
      }
      if (updates.safety !== undefined) {
        updateData.safety_cooldown_seconds = updates.safety.cooldown_seconds
        updateData.safety_max_runs_per_hour = updates.safety.max_runs_per_hour
        updateData.safety_dedupe_key_template = updates.safety.dedupe_key_template
        updateData.safety_allow_action_jobs = updates.safety.allow_action_jobs
      }

      const { error } = await supabase
        .from('jobforge_bundle_trigger_rules')
        .update(updateData)
        .eq('id', ruleId)

      if (error) {
        throw new Error(`Failed to update trigger rule: ${error.message}`)
      }

      return this.getRule(ruleId)
    },

    async deleteRule(ruleId: string): Promise<boolean> {
      const { error } = await supabase
        .from('jobforge_bundle_trigger_rules')
        .delete()
        .eq('id', ruleId)

      if (error) {
        throw new Error(`Failed to delete trigger rule: ${error.message}`)
      }

      return true
    },

    async recordEvaluation(eventId: string, ruleId: string, result: unknown): Promise<void> {
      const { error } = await supabase.rpc('jobforge_record_trigger_evaluation', {
        p_tenant_id: (result as { tenant_id?: string }).tenant_id || '',
        p_rule_id: ruleId,
        p_event_id: eventId,
        p_matched: (result as { matched?: boolean }).matched || false,
        p_decision: (result as { decision?: string }).decision || 'error',
        p_reason: (result as { reason?: string }).reason || '',
        p_dry_run: (result as { dry_run?: boolean }).dry_run || false,
        p_safety_cooldown_passed:
          (result as { safety_checks?: { cooldown_passed?: boolean } }).safety_checks
            ?.cooldown_passed || false,
        p_safety_rate_limit_passed:
          (result as { safety_checks?: { rate_limit_passed?: boolean } }).safety_checks
            ?.rate_limit_passed || false,
        p_safety_dedupe_passed:
          (result as { safety_checks?: { dedupe_passed?: boolean } }).safety_checks
            ?.dedupe_passed || false,
        p_bundle_run_id: (result as { bundle_run_id?: string }).bundle_run_id || null,
      })

      if (error) {
        console.error('Failed to record trigger evaluation:', error)
      }
    },
  }
}

// ============================================================================
// Event Ingestion Pipeline
// ============================================================================

/**
 * Complete event ingestion pipeline with trigger evaluation
 */
export async function ingestEventWithTriggers(
  supabase: SupabaseClient,
  eventParams: SubmitEventParams,
  options?: {
    autoEvaluateTriggers?: boolean
    onBundleFire?: (
      rule: BundleTriggerRule,
      event: EventEnvelope,
      bundle: JobRequestBundle
    ) => Promise<void>
  }
): Promise<EventIngestionResult> {
  const errors: string[] = []
  let bundlesQueued = 0
  let evaluationReport: TriggerEvaluationReport | undefined

  try {
    // Step 1: Submit the event
    const { data: event, error: submitError } = await supabase.rpc('jobforge_submit_event', {
      p_tenant_id: eventParams.tenant_id,
      p_event_type: eventParams.event_type,
      p_trace_id: eventParams.trace_id,
      p_source_app: eventParams.source_app,
      p_payload: eventParams.payload || {},
      p_event_version: eventParams.event_version || '1.0',
      p_project_id: eventParams.project_id || null,
      p_actor_id: eventParams.actor_id || null,
      p_source_module: eventParams.source_module || null,
      p_subject_type: eventParams.subject_type || null,
      p_subject_id: eventParams.subject_id || null,
      p_contains_pii: eventParams.contains_pii || false,
      p_redaction_hints: eventParams.redaction_hints || null,
    })

    if (submitError) {
      throw new Error(`Failed to submit event: ${submitError.message}`)
    }

    // Step 2: Evaluate triggers if enabled
    if (options?.autoEvaluateTriggers !== false && isBundleTriggersEnabled()) {
      const storage = createDatabaseTriggerStorage(supabase)
      const rules = await storage.listRules(eventParams.tenant_id, eventParams.project_id)

      if (rules.length > 0) {
        const eventEnvelope: EventEnvelope = {
          event_version: eventParams.event_version || '1.0',
          event_type: eventParams.event_type,
          occurred_at: new Date().toISOString(),
          trace_id: eventParams.trace_id,
          tenant_id: eventParams.tenant_id,
          project_id: eventParams.project_id,
          actor_id: eventParams.actor_id,
          source_app: eventParams.source_app,
          source_module: eventParams.source_module,
          subject:
            eventParams.subject_type && eventParams.subject_id
              ? { type: eventParams.subject_type, id: eventParams.subject_id }
              : undefined,
          payload: eventParams.payload || {},
          contains_pii: eventParams.contains_pii || false,
          redaction_hints: eventParams.redaction_hints,
        }

        evaluationReport = await evaluateTriggersForEvent(eventEnvelope, rules, {
          onBundleFire: async (rule, _event) => {
            // Build bundle from rule configuration
            const bundle = await buildBundleFromRule(rule, eventEnvelope)

            // Record the evaluation
            const evalResult = evaluationReport?.results.find((r) => r.rule_id === rule.rule_id)
            if (evalResult) {
              await storage.recordEvaluation(event.id, rule.rule_id, {
                ...evalResult,
                tenant_id: eventParams.tenant_id,
              })
            }

            // Call the callback if provided
            if (options?.onBundleFire) {
              await options.onBundleFire(rule, eventEnvelope, bundle)
              bundlesQueued++
            }
          },
        })
      }
    }

    return {
      event: event as EventRow,
      triggers_evaluated: evaluationReport !== undefined,
      evaluation_report: evaluationReport,
      bundles_queued: bundlesQueued,
      errors,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      event: null as unknown as EventRow,
      triggers_evaluated: false,
      bundles_queued: 0,
      errors,
    }
  }
}

/**
 * Build a JobRequestBundle from a trigger rule and event
 */
async function buildBundleFromRule(
  rule: BundleTriggerRule,
  event: EventEnvelope
): Promise<JobRequestBundle> {
  // Generate bundle from rule configuration
  const bundleId = `${rule.rule_id}-${Date.now()}`

  // Create a single request based on the rule's bundle builder or ref
  const request = {
    id: `triggered-${Date.now()}`,
    job_type: rule.action.bundle_builder || 'jobforge.autopilot.execute_request_bundle',
    tenant_id: event.tenant_id,
    project_id: event.project_id,
    payload: {
      event_trigger: true,
      rule_id: rule.rule_id,
      event_type: event.event_type,
      event_trace_id: event.trace_id,
      ...(rule.action.bundle_ref ? { bundle_ref: rule.action.bundle_ref } : {}),
    },
    idempotency_key: `${rule.rule_id}-${event.trace_id}`,
    required_scopes: rule.safety.allow_action_jobs ? ['ops:write'] : ['ops:read'],
    is_action_job: rule.safety.allow_action_jobs,
  }

  return {
    version: '1.0',
    bundle_id: bundleId,
    tenant_id: event.tenant_id,
    project_id: event.project_id,
    trace_id: event.trace_id,
    requests: [request],
    metadata: {
      source: 'bundle-trigger',
      triggered_at: new Date().toISOString(),
      correlation_id: `trigger-${rule.rule_id}`,
    },
  }
}
