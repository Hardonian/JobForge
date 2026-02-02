/**
 * JobForge Execution Plane - Bundle Trigger Rules
 * Event-driven auto-triggering for bundle execution
 */

import type { EventEnvelope } from './events.js'

// ============================================================================
// Bundle Trigger Rule Types
// ============================================================================

export type BundleSource = 'inline' | 'artifact_ref'

export interface BundleTriggerMatch {
  /** Event types that trigger this rule */
  event_type_allowlist: string[]
  /** Optional: source module filter */
  source_module_allowlist?: string[]
  /** Optional: severity threshold filter */
  severity_threshold?: string
  /** Optional: priority threshold filter */
  priority_threshold?: string
}

export interface BundleTriggerAction {
  /** How the bundle is sourced */
  bundle_source: BundleSource
  /** Reference to pre-defined bundle (for artifact_ref) */
  bundle_ref?: string
  /** Builder function/template key (for inline) */
  bundle_builder?: string
  /** Execution mode - dry_run by default for safety */
  mode: 'dry_run' | 'execute'
}

export interface BundleTriggerSafety {
  /** Cooldown between fires (seconds) */
  cooldown_seconds: number
  /** Max executions per hour */
  max_runs_per_hour: number
  /** Template for generating dedupe key */
  dedupe_key_template?: string
  /** Whether action jobs are allowed (default: false) */
  allow_action_jobs: boolean
}

export interface BundleTriggerRule {
  rule_id: string
  tenant_id: string
  project_id: string | null
  name: string
  enabled: boolean
  match: BundleTriggerMatch
  action: BundleTriggerAction
  safety: BundleTriggerSafety
  created_at: string
  updated_at: string
  last_fired_at: string | null
  fire_count: number
}

export interface CreateBundleTriggerRuleParams {
  tenant_id: string
  project_id?: string
  name: string
  enabled?: boolean
  match: BundleTriggerMatch
  action: BundleTriggerAction
  safety?: Partial<BundleTriggerSafety>
}

// ============================================================================
// Trigger Evaluation Types
// ============================================================================

export type TriggerDecision = 'fire' | 'skip' | 'rate_limited' | 'cooldown' | 'disabled' | 'error'

export interface SafetyCheckResults {
  cooldown_passed: boolean
  rate_limit_passed: boolean
  dedupe_passed: boolean
}

export interface TriggerEvaluationResult {
  rule_id: string
  event_id: string
  evaluated_at: string
  matched: boolean
  decision: TriggerDecision
  reason: string
  bundle_run_id?: string
  dry_run: boolean
  safety_checks: SafetyCheckResults
}

export interface TriggerEvaluationReport {
  event_id: string
  evaluated_at: string
  tenant_id: string
  rules_evaluated: number
  rules_matched: number
  rules_fired: number
  results: TriggerEvaluationResult[]
}

// ============================================================================
// Bundle Execution Types
// ============================================================================

export interface BundleRunRequest {
  rule_id: string
  event: EventEnvelope
  bundle_source: BundleSource
  bundle_ref?: string
  bundle_builder?: string
  mode: 'dry_run' | 'execute'
  safety_context: {
    allow_action_jobs: boolean
    policy_token?: string
  }
}

export interface BundleRunResult {
  bundle_run_id: string
  rule_id: string
  event_id: string
  status: 'accepted' | 'rejected' | 'dry_run' | 'executed' | 'error'
  reason?: string
  dry_run: boolean
  manifest_ref?: string
  child_runs?: Array<{
    request_id: string
    job_type: string
    status: string
  }>
}

// ============================================================================
// In-Memory Storage (for development/testing)
// Production should use database
// ============================================================================

const triggerRulesStore = new Map<string, BundleTriggerRule>()
const evaluationHistoryStore = new Map<string, TriggerEvaluationResult[]>()
const lastFireTimeStore = new Map<string, string>() // rule_id -> ISO timestamp
const fireCountHourlyStore = new Map<string, number>() // rule_id -> count

// ============================================================================
// Trigger Evaluation Engine
// ============================================================================

/**
 * Evaluate all trigger rules against an incoming event
 */
export function evaluateTriggers(
  event: EventEnvelope,
  rules: BundleTriggerRule[],
  options?: {
    bundleTriggersEnabled?: boolean
    currentTime?: Date
  }
): TriggerEvaluationReport {
  const now = options?.currentTime || new Date()
  const results: TriggerEvaluationResult[] = []

  // Feature flag check
  if (options?.bundleTriggersEnabled === false) {
    return {
      event_id: event.trace_id,
      evaluated_at: now.toISOString(),
      tenant_id: event.tenant_id,
      rules_evaluated: 0,
      rules_matched: 0,
      rules_fired: 0,
      results: [],
    }
  }

  for (const rule of rules) {
    // Only evaluate rules for matching tenant
    if (rule.tenant_id !== event.tenant_id) {
      continue
    }

    // Check project scoping
    if (rule.project_id && rule.project_id !== event.project_id) {
      continue
    }

    const result = evaluateSingleRule(event, rule, now, options?.bundleTriggersEnabled)
    results.push(result)

    // Store in history
    const history = evaluationHistoryStore.get(rule.rule_id) || []
    history.push(result)
    evaluationHistoryStore.set(rule.rule_id, history.slice(-100)) // Keep last 100
  }

  return {
    event_id: event.trace_id,
    evaluated_at: now.toISOString(),
    tenant_id: event.tenant_id,
    rules_evaluated: results.length,
    rules_matched: results.filter((r) => r.matched).length,
    rules_fired: results.filter((r) => r.decision === 'fire').length,
    results,
  }
}

/**
 * Evaluate a single trigger rule against an event
 */
function evaluateSingleRule(
  event: EventEnvelope,
  rule: BundleTriggerRule,
  now: Date,
  bundleTriggersEnabled?: boolean
): TriggerEvaluationResult {
  const eventId = event.trace_id

  // Check feature flag
  if (bundleTriggersEnabled === false) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: false,
      decision: 'disabled',
      reason: 'Bundle triggers feature flag is disabled',
      dry_run: true,
      safety_checks: {
        cooldown_passed: false,
        rate_limit_passed: false,
        dedupe_passed: false,
      },
    }
  }

  // Check if rule is enabled
  if (!rule.enabled) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: false,
      decision: 'disabled',
      reason: 'Trigger rule is disabled',
      dry_run: true,
      safety_checks: {
        cooldown_passed: false,
        rate_limit_passed: false,
        dedupe_passed: false,
      },
    }
  }

  // Check event type match
  if (!rule.match.event_type_allowlist.includes(event.event_type)) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: false,
      decision: 'skip',
      reason: `Event type '${event.event_type}' not in allowlist`,
      dry_run: true,
      safety_checks: {
        cooldown_passed: false,
        rate_limit_passed: false,
        dedupe_passed: false,
      },
    }
  }

  // Check source module filter
  if (
    rule.match.source_module_allowlist?.length &&
    event.source_module &&
    !rule.match.source_module_allowlist.includes(event.source_module)
  ) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: false,
      decision: 'skip',
      reason: `Source module '${event.source_module}' not in allowlist`,
      dry_run: true,
      safety_checks: {
        cooldown_passed: false,
        rate_limit_passed: false,
        dedupe_passed: false,
      },
    }
  }

  // Run safety checks
  const safetyChecks = runSafetyChecks(rule, event, now)

  if (!safetyChecks.cooldown_passed) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: true,
      decision: 'cooldown',
      reason: 'Cooldown period not elapsed',
      dry_run: true,
      safety_checks: safetyChecks,
    }
  }

  if (!safetyChecks.rate_limit_passed) {
    return {
      rule_id: rule.rule_id,
      event_id: eventId,
      evaluated_at: now.toISOString(),
      matched: true,
      decision: 'rate_limited',
      reason: 'Rate limit exceeded (max runs per hour)',
      dry_run: true,
      safety_checks: safetyChecks,
    }
  }

  // Rule matched and passed safety checks
  const isDryRun = rule.action.mode === 'dry_run'

  return {
    rule_id: rule.rule_id,
    event_id: eventId,
    evaluated_at: now.toISOString(),
    matched: true,
    decision: 'fire',
    reason: isDryRun ? 'Would execute bundle (dry run)' : 'Bundle execution triggered',
    dry_run: isDryRun,
    safety_checks: safetyChecks,
  }
}

/**
 * Run safety checks for a trigger rule
 */
function runSafetyChecks(
  rule: BundleTriggerRule,
  _event: EventEnvelope,
  now: Date
): SafetyCheckResults {
  const results: SafetyCheckResults = {
    cooldown_passed: true,
    rate_limit_passed: true,
    dedupe_passed: true,
  }

  // Cooldown check
  const lastFireTime = lastFireTimeStore.get(rule.rule_id)
  if (lastFireTime) {
    const elapsed = now.getTime() - new Date(lastFireTime).getTime()
    const cooldownMs = rule.safety.cooldown_seconds * 1000
    if (elapsed < cooldownMs) {
      results.cooldown_passed = false
    }
  }

  // Rate limit check
  const fireCount = fireCountHourlyStore.get(rule.rule_id) || 0
  if (fireCount >= rule.safety.max_runs_per_hour) {
    results.rate_limit_passed = false
  }

  return results
}

// ============================================================================
// Storage Operations (In-Memory)
// ============================================================================

/**
 * Create a new trigger rule
 */
export function createTriggerRule(params: CreateBundleTriggerRuleParams): BundleTriggerRule {
  const rule: BundleTriggerRule = {
    rule_id: crypto.randomUUID(),
    tenant_id: params.tenant_id,
    project_id: params.project_id || null,
    name: params.name,
    enabled: params.enabled ?? false,
    match: params.match,
    action: params.action,
    safety: {
      cooldown_seconds: 60,
      max_runs_per_hour: 10,
      allow_action_jobs: false,
      ...params.safety,
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    last_fired_at: null,
    fire_count: 0,
  }

  triggerRulesStore.set(rule.rule_id, rule)
  return rule
}

/**
 * Get a trigger rule by ID
 */
export function getTriggerRule(ruleId: string): BundleTriggerRule | undefined {
  return triggerRulesStore.get(ruleId)
}

/**
 * List all trigger rules for a tenant
 */
export function listTriggerRules(tenantId: string, projectId?: string): BundleTriggerRule[] {
  const rules: BundleTriggerRule[] = []
  for (const rule of triggerRulesStore.values()) {
    if (rule.tenant_id === tenantId) {
      if (!projectId || rule.project_id === projectId) {
        rules.push(rule)
      }
    }
  }
  return rules
}

/**
 * Update a trigger rule
 */
export function updateTriggerRule(
  ruleId: string,
  updates: Partial<Omit<BundleTriggerRule, 'rule_id' | 'tenant_id' | 'created_at'>>
): BundleTriggerRule | undefined {
  const rule = triggerRulesStore.get(ruleId)
  if (!rule) return undefined

  const updated: BundleTriggerRule = {
    ...rule,
    ...updates,
    updated_at: new Date().toISOString(),
  }

  triggerRulesStore.set(ruleId, updated)
  return updated
}

/**
 * Delete a trigger rule
 */
export function deleteTriggerRule(ruleId: string): boolean {
  return triggerRulesStore.delete(ruleId)
}

/**
 * Record a trigger fire (updates last_fire_time and count)
 */
export function recordTriggerFire(ruleId: string): void {
  const now = new Date().toISOString()
  lastFireTimeStore.set(ruleId, now)
  fireCountHourlyStore.set(ruleId, (fireCountHourlyStore.get(ruleId) || 0) + 1)

  const rule = triggerRulesStore.get(ruleId)
  if (rule) {
    rule.last_fired_at = now
    rule.fire_count++
  }
}

/**
 * Get evaluation history for a rule
 */
export function getEvaluationHistory(ruleId: string): TriggerEvaluationResult[] {
  return evaluationHistoryStore.get(ruleId) || []
}

/**
 * Clear all in-memory storage (for testing)
 */
export function clearTriggerStorage(): void {
  triggerRulesStore.clear()
  evaluationHistoryStore.clear()
  lastFireTimeStore.clear()
  fireCountHourlyStore.clear()
}
