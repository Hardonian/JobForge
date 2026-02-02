/**
 * JobForge Trigger Safety Gate
 * Safety controls for cron + event-driven triggers
 * All triggers remain OFF unless JOBFORGE_TRIGGERS_ENABLED=1
 */

import { checkDuplicateEvent, checkRateLimit, writeAuditLog, redactObject } from './security'
import { JOBFORGE_TRIGGERS_ENABLED } from './feature-flags'
import { randomUUID } from 'crypto'

// ============================================================================
// Safety Constants
// ============================================================================

const DEFAULT_COOLDOWN_MS = 60000 // 1 minute between trigger fires
const DEFAULT_MAX_RUNS_PER_HOUR = 100
const DEFAULT_DRY_RUN = true // Default to dry-run mode for safety

// ============================================================================
// Trigger Safety Types
// ============================================================================

import type { TriggerType } from './execution-plane/triggers'

export interface TriggerSafetyConfig {
  // Loop prevention
  cooldownMs: number
  maxRunsPerHour: number
  // Blast radius
  allowedEventTypes: string[] | null // null = all allowed
  allowedJobTypes: string[] | null // null = all allowed
  // Dry run mode
  dryRun: boolean
  // Rate limiting
  rateLimitMax: number
  rateLimitWindowMs: number
}

export interface TriggerFireRequest {
  triggerId: string
  triggerType: TriggerType
  tenantId: string
  projectId?: string
  eventType?: string
  jobType: string
  actorId?: string
  traceId: string
}

export interface TriggerFireDecision {
  allowed: boolean
  dryRun: boolean
  reason: string
  action: 'fire' | 'block' | 'dry_run'
  decisionId: string
  timestamp: string
  metadata: {
    cooldownRemainingMs?: number
    runsThisHour: number
    rateLimitRemaining?: number
    isDuplicate?: boolean
  }
}

export interface DryRunRecord {
  id: string
  timestamp: string
  triggerId: string
  triggerType: TriggerType
  tenantId: string
  projectId?: string
  eventType?: string
  jobType: string
  reason: string
  wouldHaveFired: boolean
  traceId: string
}

// ============================================================================
// Trigger Safety State (in-memory, per-tenant)
// ============================================================================

interface TriggerState {
  lastFiredAt: number
  fireCountThisHour: number
  hourStart: number
}

class TriggerSafetyStore {
  private triggers = new Map<string, TriggerState>()
  private dryRunRecords: DryRunRecord[] = []
  private lastCleanup = Date.now()
  private cleanupInterval = 3600000 // 1 hour

  getState(triggerId: string, tenantId: string): TriggerState {
    const key = `${tenantId}:${triggerId}`
    const now = Date.now()

    let state = this.triggers.get(key)
    if (!state) {
      state = {
        lastFiredAt: 0,
        fireCountThisHour: 0,
        hourStart: now,
      }
      this.triggers.set(key, state)
    }

    // Reset hourly counter if needed
    if (now - state.hourStart > 3600000) {
      state.fireCountThisHour = 0
      state.hourStart = now
    }

    // Periodic cleanup
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup()
    }

    return state
  }

  recordFire(triggerId: string, tenantId: string): void {
    const key = `${tenantId}:${triggerId}`
    const state = this.getState(triggerId, tenantId)
    state.lastFiredAt = Date.now()
    state.fireCountThisHour++
    this.triggers.set(key, state)
  }

  addDryRunRecord(record: DryRunRecord): void {
    this.dryRunRecords.push(record)

    // Keep only last 1000 records
    if (this.dryRunRecords.length > 1000) {
      this.dryRunRecords = this.dryRunRecords.slice(-1000)
    }
  }

  queryDryRunRecords(
    tenantId: string,
    options: { from?: Date; to?: Date; limit?: number } = {}
  ): DryRunRecord[] {
    const { from, to, limit = 100 } = options

    let results = this.dryRunRecords.filter((r) => r.tenantId === tenantId)

    if (from) {
      results = results.filter((r) => new Date(r.timestamp) >= from)
    }
    if (to) {
      results = results.filter((r) => new Date(r.timestamp) <= to)
    }

    return results.slice(-limit)
  }

  private cleanup(): void {
    const now = Date.now()
    const oneHour = 3600000

    for (const [key, state] of this.triggers.entries()) {
      if (now - state.hourStart > oneHour) {
        this.triggers.delete(key)
      }
    }

    this.lastCleanup = now
  }

  clear(): void {
    this.triggers.clear()
    this.dryRunRecords = []
  }
}

// Singleton store
const safetyStore = new TriggerSafetyStore()

// ============================================================================
// Trigger Safety Gate
// ============================================================================

/**
 * Evaluate trigger fire request with all safety checks
 * Returns decision - caller must respect decision.action
 */
export function evaluateTriggerFire(
  request: TriggerFireRequest,
  config: Partial<TriggerSafetyConfig> = {}
): TriggerFireDecision {
  const now = Date.now()
  const decisionId = randomUUID()

  // Check if triggers are globally enabled
  if (!JOBFORGE_TRIGGERS_ENABLED) {
    return {
      allowed: false,
      dryRun: true,
      reason: 'Triggers are globally disabled (JOBFORGE_TRIGGERS_ENABLED=0)',
      action: 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata: {
        runsThisHour: 0,
      },
    }
  }

  const fullConfig: TriggerSafetyConfig = {
    cooldownMs: DEFAULT_COOLDOWN_MS,
    maxRunsPerHour: DEFAULT_MAX_RUNS_PER_HOUR,
    allowedEventTypes: null,
    allowedJobTypes: null,
    dryRun: DEFAULT_DRY_RUN,
    rateLimitMax: 100,
    rateLimitWindowMs: 60000,
    ...config,
  }

  const state = safetyStore.getState(request.triggerId, request.tenantId)
  const metadata: TriggerFireDecision['metadata'] = {
    runsThisHour: state.fireCountThisHour,
  }

  // 1. Check cooldown
  const timeSinceLastFire = now - state.lastFiredAt
  if (timeSinceLastFire < fullConfig.cooldownMs) {
    metadata.cooldownRemainingMs = fullConfig.cooldownMs - timeSinceLastFire

    const decision: TriggerFireDecision = {
      allowed: false,
      dryRun: fullConfig.dryRun,
      reason: `Cooldown period active: ${metadata.cooldownRemainingMs}ms remaining`,
      action: fullConfig.dryRun ? 'dry_run' : 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata,
    }

    recordDryRunIfNeeded(request, decision, fullConfig)
    return decision
  }

  // 2. Check max runs per hour
  if (state.fireCountThisHour >= fullConfig.maxRunsPerHour) {
    const decision: TriggerFireDecision = {
      allowed: false,
      dryRun: fullConfig.dryRun,
      reason: `Max runs per hour exceeded: ${fullConfig.maxRunsPerHour}`,
      action: fullConfig.dryRun ? 'dry_run' : 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata,
    }

    recordDryRunIfNeeded(request, decision, fullConfig)
    return decision
  }

  // 3. Check rate limit (per-tenant)
  const rateLimit = checkRateLimit(request.tenantId, request.actorId, {
    maxRequests: fullConfig.rateLimitMax,
    windowMs: fullConfig.rateLimitWindowMs,
    perActor: false,
  })
  metadata.rateLimitRemaining = rateLimit.remaining

  if (!rateLimit.allowed) {
    const decision: TriggerFireDecision = {
      allowed: false,
      dryRun: fullConfig.dryRun,
      reason: `Rate limit exceeded: ${rateLimit.reason}`,
      action: fullConfig.dryRun ? 'dry_run' : 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata,
    }

    recordDryRunIfNeeded(request, decision, fullConfig)
    return decision
  }

  // 4. Check allow/deny lists for event types
  if (
    fullConfig.allowedEventTypes !== null &&
    request.eventType &&
    !fullConfig.allowedEventTypes.includes(request.eventType)
  ) {
    const decision: TriggerFireDecision = {
      allowed: false,
      dryRun: fullConfig.dryRun,
      reason: `Event type '${request.eventType}' not in allowlist`,
      action: 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata,
    }

    recordDryRunIfNeeded(request, decision, fullConfig)
    return decision
  }

  // 5. Check allow/deny lists for job types
  if (
    fullConfig.allowedJobTypes !== null &&
    !fullConfig.allowedJobTypes.includes(request.jobType)
  ) {
    const decision: TriggerFireDecision = {
      allowed: false,
      dryRun: fullConfig.dryRun,
      reason: `Job type '${request.jobType}' not in allowlist`,
      action: 'block',
      decisionId,
      timestamp: new Date().toISOString(),
      metadata,
    }

    recordDryRunIfNeeded(request, decision, fullConfig)
    return decision
  }

  // 6. Check dedupe for event-driven triggers
  if (request.triggerType === 'event' && request.eventType) {
    const dedupeKey = `${request.triggerId}:${request.eventType}:${request.traceId}`
    const duplicate = checkDuplicateEvent(request.tenantId, dedupeKey, 'trigger_event')
    metadata.isDuplicate = duplicate.isDuplicate

    if (duplicate.isDuplicate) {
      const decision: TriggerFireDecision = {
        allowed: false,
        dryRun: fullConfig.dryRun,
        reason: 'Duplicate event detected (idempotency)',
        action: fullConfig.dryRun ? 'dry_run' : 'block',
        decisionId,
        timestamp: new Date().toISOString(),
        metadata,
      }

      recordDryRunIfNeeded(request, decision, fullConfig)
      return decision
    }
  }

  // All checks passed - allow fire (or dry-run)
  const decision: TriggerFireDecision = {
    allowed: true,
    dryRun: fullConfig.dryRun,
    reason: fullConfig.dryRun ? 'Dry-run mode enabled' : 'All safety checks passed',
    action: fullConfig.dryRun ? 'dry_run' : 'fire',
    decisionId,
    timestamp: new Date().toISOString(),
    metadata,
  }

  recordDryRunIfNeeded(request, decision, fullConfig)

  // Record actual fire (updates state)
  if (!fullConfig.dryRun) {
    safetyStore.recordFire(request.triggerId, request.tenantId)
  }

  // Audit log
  writeAuditLog({
    tenantId: request.tenantId,
    projectId: request.projectId,
    actorId: request.actorId,
    action: 'trigger_fire',
    resource: request.triggerId,
    resourceId: request.triggerId,
    decision: decision.action === 'fire' ? 'allow' : 'deny',
    reason: decision.reason,
    metadata: redactObject({
      triggerType: request.triggerType,
      eventType: request.eventType,
      jobType: request.jobType,
      ...metadata,
    }),
  })

  return decision
}

function recordDryRunIfNeeded(
  request: TriggerFireRequest,
  decision: TriggerFireDecision,
  config: TriggerSafetyConfig
): void {
  if (config.dryRun || decision.action === 'dry_run') {
    const record: DryRunRecord = {
      id: decision.decisionId,
      timestamp: decision.timestamp,
      triggerId: request.triggerId,
      triggerType: request.triggerType,
      tenantId: request.tenantId,
      projectId: request.projectId,
      eventType: request.eventType,
      jobType: request.jobType,
      reason: decision.reason,
      wouldHaveFired: decision.action === 'fire' || decision.action === 'dry_run',
      traceId: request.traceId,
    }
    safetyStore.addDryRunRecord(record)
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Query dry-run records for tenant
 */
export function queryDryRunRecords(
  tenantId: string,
  options: { from?: Date; to?: Date; limit?: number } = {}
): DryRunRecord[] {
  return safetyStore.queryDryRunRecords(tenantId, options)
}

/**
 * Get trigger safety summary for tenant
 */
export function getTriggerSafetySummary(tenantId: string): {
  triggerCount: number
  dryRunRecordCount: number
  globalTriggersEnabled: boolean
} {
  const allRecords = safetyStore.queryDryRunRecords(tenantId, { limit: 10000 })

  return {
    triggerCount: new Set(allRecords.map((r) => r.triggerId)).size,
    dryRunRecordCount: allRecords.length,
    globalTriggersEnabled: JOBFORGE_TRIGGERS_ENABLED,
  }
}

/**
 * Clear all trigger safety state (for testing)
 */
export function clearTriggerSafetyState(): void {
  safetyStore.clear()
}

// ============================================================================
// Default Safety Config Factory
// ============================================================================

/**
 * Create strict safety config for production
 */
export function createStrictSafetyConfig(
  allowedEventTypes: string[],
  allowedJobTypes: string[]
): TriggerSafetyConfig {
  return {
    cooldownMs: 60000,
    maxRunsPerHour: 50,
    allowedEventTypes,
    allowedJobTypes,
    dryRun: !JOBFORGE_TRIGGERS_ENABLED, // Force dry-run if triggers disabled
    rateLimitMax: 100,
    rateLimitWindowMs: 60000,
  }
}

/**
 * Create permissive safety config for development
 */
export function createPermissiveSafetyConfig(): TriggerSafetyConfig {
  return {
    cooldownMs: 1000,
    maxRunsPerHour: 1000,
    allowedEventTypes: null, // Allow all
    allowedJobTypes: null, // Allow all
    dryRun: false,
    rateLimitMax: 1000,
    rateLimitWindowMs: 60000,
  }
}
