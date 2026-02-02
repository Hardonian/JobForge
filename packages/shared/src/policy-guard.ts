/**
 * JobForge Policy Guard
 * Enforceable policy layer preventing silent expansion of automation authority
 *
 * Feature flag: JOBFORGE_POLICY_GUARD_ENABLED=1
 * Default: OFF (safe default)
 *
 * Core Principles:
 * - No autonomy creep: actions require explicit policy tokens + flags
 * - Per-tenant scoping: all policies scoped to tenant + optional project
 * - Action categorization: clear distinction between action vs non-action jobs
 * - Drift detection: CI-enforceable checks for new job types
 */

import { z } from 'zod'
import { validatePolicyTokenForAction, type PolicyValidationOptions } from './policy-tokens.js'
import {
  JOBFORGE_POLICY_GUARD_ENABLED,
  JOBFORGE_ACTION_JOBS_ENABLED,
  JOBFORGE_BUNDLE_EXECUTOR_ENABLED,
  JOBFORGE_REQUIRE_POLICY_TOKENS,
  JOBFORGE_POLICY_TOKEN_SECRET,
} from './feature-flags.js'

// ============================================================================
// Types and Schemas
// ============================================================================

/**
 * Automation level - how much autonomy is granted
 */
export enum AutomationLevel {
  OBSERVE_ONLY = 'OBSERVE_ONLY', // Read-only operations
  RECOMMEND_ONLY = 'RECOMMEND_ONLY', // Suggest actions, never execute
  EXECUTE_NON_ACTION = 'EXECUTE_NON_ACTION', // Execute safe, non-destructive jobs
  EXECUTE_ACTION = 'EXECUTE_ACTION', // Execute action jobs (requires explicit opt-in)
}

/**
 * Job categorization
 */
export enum JobCategory {
  READ = 'READ', // Read-only queries
  ANALYZE = 'ANALYZE', // Analysis without side effects
  RECOMMEND = 'RECOMMEND', // Generate recommendations
  NOTIFY = 'NOTIFY', // Send notifications/alerts
  ACTION = 'ACTION', // Write operations, state changes
}

/**
 * Policy Guard decision
 */
export interface PolicyDecision {
  allowed: boolean
  reason: string
  requiredLevel: AutomationLevel
  currentLevel: AutomationLevel
  requiresPolicyToken: boolean
  policyTokenValid?: boolean
  scopes?: string[]
}

/**
 * Policy report for a tenant
 */
export interface PolicyReport {
  tenantId: string
  projectId?: string
  timestamp: string
  automationLevel: AutomationLevel
  allowedJobTypes: string[]
  blockedJobTypes: string[]
  recentDenials: PolicyDenial[]
  driftAlerts: DriftAlert[]
}

/**
 * Policy denial record
 */
export interface PolicyDenial {
  timestamp: string
  jobType: string
  reason: string
  requiredLevel: AutomationLevel
  attemptedToken?: boolean
}

/**
 * Drift alert for new uncategorized job types
 */
export interface DriftAlert {
  jobType: string
  detectedAt: string
  category: 'uncategorized' | 'new_action' | 'missing_template'
  severity: 'warning' | 'critical'
  message: string
}

/**
 * Tenant policy configuration
 */
export const TenantPolicySchema = z.object({
  tenantId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  automationLevel: z.nativeEnum(AutomationLevel).default(AutomationLevel.RECOMMEND_ONLY),
  allowedJobTypes: z.array(z.string()).default([]),
  blockedJobTypes: z.array(z.string()).default([]),
  requirePolicyTokenForActions: z.boolean().default(true),
  maxConcurrentActions: z.number().int().positive().default(5),
  actionRateLimitPerHour: z.number().int().positive().default(10),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type TenantPolicy = z.infer<typeof TenantPolicySchema>

// ============================================================================
// Job Type Registry and Categorization
// ============================================================================

/**
 * Built-in job type categorization
 * This registry MUST be updated when adding new job types
 * CI enforces that all job types in templates are categorized
 */
export const JOB_TYPE_CATEGORIES: Record<string, JobCategory> = {
  // Core connector jobs
  'connector.http.request': JobCategory.READ,
  'connector.webhook.deliver': JobCategory.NOTIFY,
  'connector.report.generate': JobCategory.READ,

  // Autopilot ops jobs
  'autopilot.ops.scan': JobCategory.ANALYZE,
  'autopilot.ops.diagnose': JobCategory.ANALYZE,
  'autopilot.ops.recommend': JobCategory.RECOMMEND,
  'autopilot.ops.apply': JobCategory.ACTION,

  // Autopilot support jobs
  'autopilot.support.triage': JobCategory.ANALYZE,
  'autopilot.support.draft_reply': JobCategory.RECOMMEND,
  'autopilot.support.propose_kb_patch': JobCategory.RECOMMEND,

  // Autopilot growth jobs
  'autopilot.growth.seo_scan': JobCategory.ANALYZE,
  'autopilot.growth.experiment_propose': JobCategory.RECOMMEND,
  'autopilot.growth.content_draft': JobCategory.RECOMMEND,

  // Autopilot finops jobs
  'autopilot.finops.reconcile': JobCategory.ANALYZE,
  'autopilot.finops.anomaly_scan': JobCategory.ANALYZE,
  'autopilot.finops.churn_risk_report': JobCategory.ANALYZE,
}

/**
 * Job types that require explicit policy tokens
 */
export const ACTION_JOB_TYPES = Object.entries(JOB_TYPE_CATEGORIES)
  .filter(([, category]) => category === JobCategory.ACTION)
  .map(([jobType]) => jobType)

/**
 * Check if a job type is categorized
 */
export function isJobTypeCategorized(jobType: string): boolean {
  return jobType in JOB_TYPE_CATEGORIES
}

/**
 * Get job category
 */
export function getJobCategory(jobType: string): JobCategory | null {
  return JOB_TYPE_CATEGORIES[jobType] || null
}

/**
 * Check if job type is an action (requires policy token)
 */
export function isActionJob(jobType: string): boolean {
  return getJobCategory(jobType) === JobCategory.ACTION
}

// ============================================================================
// Policy Guard Core
// ============================================================================

export class PolicyGuard {
  private tenantPolicies: Map<string, TenantPolicy> = new Map()
  private denialLog: Map<string, PolicyDenial[]> = new Map()
  private driftAlerts: Map<string, DriftAlert[]> = new Map()

  /**
   * Check if Policy Guard is enabled
   */
  isEnabled(): boolean {
    return JOBFORGE_POLICY_GUARD_ENABLED
  }

  /**
   * Set tenant policy
   */
  setTenantPolicy(policy: TenantPolicy): void {
    const key = this.getPolicyKey(policy.tenantId, policy.projectId)
    this.tenantPolicies.set(key, {
      ...policy,
      updatedAt: new Date().toISOString(),
    })
  }

  /**
   * Get tenant policy
   */
  getTenantPolicy(tenantId: string, projectId?: string): TenantPolicy {
    const key = this.getPolicyKey(tenantId, projectId)
    const existing = this.tenantPolicies.get(key)

    if (existing) return existing

    // Return default policy
    return {
      tenantId,
      projectId,
      automationLevel: AutomationLevel.RECOMMEND_ONLY,
      allowedJobTypes: [],
      blockedJobTypes: [],
      requirePolicyTokenForActions: true,
      maxConcurrentActions: 5,
      actionRateLimitPerHour: 10,
    }
  }

  /**
   * Evaluate if a job execution is allowed
   */
  evaluateJobExecution(
    tenantId: string,
    jobType: string,
    options: {
      projectId?: string
      policyToken?: string
      isDryRun?: boolean
    } = {}
  ): PolicyDecision {
    // If Policy Guard is disabled, allow but warn
    if (!this.isEnabled()) {
      return {
        allowed: true,
        reason: 'Policy Guard is disabled - using permissive mode',
        requiredLevel: AutomationLevel.OBSERVE_ONLY,
        currentLevel: AutomationLevel.EXECUTE_ACTION,
        requiresPolicyToken: false,
      }
    }

    const policy = this.getTenantPolicy(tenantId, options.projectId)
    const category = getJobCategory(jobType)
    const isAction = category === JobCategory.ACTION

    // Check if job type is blocked
    if (policy.blockedJobTypes.includes(jobType)) {
      return this.createDenial(
        policy,
        jobType,
        'Job type is explicitly blocked for this tenant',
        options.policyToken !== undefined
      )
    }

    // Check if job type is allowed
    if (policy.allowedJobTypes.length > 0 && !policy.allowedJobTypes.includes(jobType)) {
      return this.createDenial(
        policy,
        jobType,
        'Job type not in tenant allowlist',
        options.policyToken !== undefined
      )
    }

    // Check for uncategorized job types (drift detection)
    if (!category) {
      this.addDriftAlert(tenantId, {
        jobType,
        detectedAt: new Date().toISOString(),
        category: 'uncategorized',
        severity: 'critical',
        message: `Job type ${jobType} is not categorized - cannot determine automation level`,
      })

      return {
        allowed: false,
        reason: `Job type ${jobType} is not categorized - add to JOB_TYPE_CATEGORIES`,
        requiredLevel: AutomationLevel.OBSERVE_ONLY,
        currentLevel: policy.automationLevel,
        requiresPolicyToken: false,
      }
    }

    // Determine required automation level based on category
    const requiredLevel = this.getRequiredLevelForCategory(category)

    // Check if current level meets requirement
    const levelSufficient = this.isLevelSufficient(policy.automationLevel, requiredLevel)

    if (!levelSufficient) {
      return this.createDenial(
        policy,
        jobType,
        `Automation level insufficient: ${policy.automationLevel} < ${requiredLevel}`,
        options.policyToken !== undefined,
        requiredLevel
      )
    }

    // Check action job requirements
    if (isAction) {
      // Action jobs must be enabled globally
      if (!JOBFORGE_ACTION_JOBS_ENABLED) {
        return this.createDenial(
          policy,
          jobType,
          'Action jobs are disabled globally (JOBFORGE_ACTION_JOBS_ENABLED=0)',
          options.policyToken !== undefined,
          requiredLevel
        )
      }

      // Check policy token
      if (policy.requirePolicyTokenForActions) {
        if (!options.policyToken) {
          return this.createDenial(
            policy,
            jobType,
            'Action jobs require policy token (requirePolicyTokenForActions=true)',
            false,
            requiredLevel
          )
        }

        // Validate policy token
        const tokenResult = this.validateActionPolicyToken(options.policyToken, tenantId, jobType)

        if (!tokenResult.valid) {
          return {
            allowed: false,
            reason: `Policy token invalid: ${tokenResult.reason}`,
            requiredLevel,
            currentLevel: policy.automationLevel,
            requiresPolicyToken: true,
            policyTokenValid: false,
          }
        }

        return {
          allowed: true,
          reason: 'Action job approved with valid policy token',
          requiredLevel,
          currentLevel: policy.automationLevel,
          requiresPolicyToken: true,
          policyTokenValid: true,
          scopes: tokenResult.claims?.scopes,
        }
      }
    }

    // Dry run is always allowed at RECOMMEND_ONLY or higher
    if (options.isDryRun && policy.automationLevel >= AutomationLevel.RECOMMEND_ONLY) {
      return {
        allowed: true,
        reason: 'Dry-run execution approved',
        requiredLevel,
        currentLevel: policy.automationLevel,
        requiresPolicyToken: isAction,
      }
    }

    return {
      allowed: true,
      reason: 'Job execution approved',
      requiredLevel,
      currentLevel: policy.automationLevel,
      requiresPolicyToken: isAction && policy.requirePolicyTokenForActions,
    }
  }

  /**
   * Validate policy token for action job
   */
  private validateActionPolicyToken(
    token: string,
    tenantId: string,
    jobType: string
  ): { valid: boolean; reason?: string; claims?: { scopes: string[] } } {
    if (!JOBFORGE_REQUIRE_POLICY_TOKENS) {
      return { valid: true, reason: 'Policy token requirement disabled' }
    }

    if (!JOBFORGE_POLICY_TOKEN_SECRET) {
      return {
        valid: false,
        reason: 'JOBFORGE_POLICY_TOKEN_SECRET not set - cannot validate tokens',
      }
    }

    const result = validatePolicyTokenForAction(token, {
      secret: JOBFORGE_POLICY_TOKEN_SECRET,
      requiredAction: jobType,
      requiredScopes: ['action:execute'],
      requiredTenantId: tenantId,
    })

    if (!result.valid) {
      return { valid: false, reason: result.reason || 'Token validation failed' }
    }

    return {
      valid: true,
      claims: { scopes: result.claims?.scopes || [] },
    }
  }

  /**
   * Create a denial decision and log it
   */
  private createDenial(
    policy: TenantPolicy,
    jobType: string,
    reason: string,
    attemptedToken: boolean,
    requiredLevel?: AutomationLevel
  ): PolicyDecision {
    const denial: PolicyDenial = {
      timestamp: new Date().toISOString(),
      jobType,
      reason,
      requiredLevel: requiredLevel || AutomationLevel.OBSERVE_ONLY,
      attemptedToken,
    }

    this.logDenial(policy.tenantId, denial)

    return {
      allowed: false,
      reason,
      requiredLevel: requiredLevel || AutomationLevel.OBSERVE_ONLY,
      currentLevel: policy.automationLevel,
      requiresPolicyToken: policy.requirePolicyTokenForActions,
    }
  }

  /**
   * Log a denial
   */
  private logDenial(tenantId: string, denial: PolicyDenial): void {
    const key = tenantId
    const existing = this.denialLog.get(key) || []
    existing.push(denial)

    // Keep only last 100 denials
    if (existing.length > 100) {
      existing.shift()
    }

    this.denialLog.set(key, existing)
  }

  /**
   * Add drift alert
   */
  private addDriftAlert(tenantId: string, alert: DriftAlert): void {
    const key = tenantId
    const existing = this.driftAlerts.get(key) || []
    existing.push(alert)
    this.driftAlerts.set(key, existing)
  }

  /**
   * Get policy key
   */
  private getPolicyKey(tenantId: string, projectId?: string): string {
    return projectId ? `${tenantId}:${projectId}` : tenantId
  }

  /**
   * Get required automation level for job category
   */
  private getRequiredLevelForCategory(category: JobCategory): AutomationLevel {
    switch (category) {
      case JobCategory.READ:
      case JobCategory.ANALYZE:
        return AutomationLevel.OBSERVE_ONLY
      case JobCategory.RECOMMEND:
      case JobCategory.NOTIFY:
        return AutomationLevel.RECOMMEND_ONLY
      default:
        return AutomationLevel.EXECUTE_ACTION
    }
  }

  /**
   * Check if current level meets required level
   */
  private isLevelSufficient(current: AutomationLevel, required: AutomationLevel): boolean {
    const levels = [
      AutomationLevel.OBSERVE_ONLY,
      AutomationLevel.RECOMMEND_ONLY,
      AutomationLevel.EXECUTE_NON_ACTION,
      AutomationLevel.EXECUTE_ACTION,
    ]

    const currentIndex = levels.indexOf(current)
    const requiredIndex = levels.indexOf(required)

    return currentIndex >= requiredIndex
  }

  /**
   * Generate policy report for tenant
   */
  generateReport(tenantId: string, projectId?: string): PolicyReport {
    const policy = this.getTenantPolicy(tenantId, projectId)
    const denials = this.denialLog.get(tenantId) || []
    const alerts = this.driftAlerts.get(tenantId) || []

    // Filter action jobs based on policy
    const allJobTypes = Object.keys(JOB_TYPE_CATEGORIES)
    const blocked: string[] = []
    const allowed: string[] = []

    for (const jobType of allJobTypes) {
      const decision = this.evaluateJobExecution(tenantId, jobType, { projectId })
      if (decision.allowed) {
        allowed.push(jobType)
      } else {
        blocked.push(jobType)
      }
    }

    return {
      tenantId,
      projectId,
      timestamp: new Date().toISOString(),
      automationLevel: policy.automationLevel,
      allowedJobTypes: allowed,
      blockedJobTypes: blocked,
      recentDenials: denials.slice(-20),
      driftAlerts: alerts,
    }
  }

  /**
   * Detect policy drift - call this in CI
   */
  detectDrift(): {
    hasDrift: boolean
    uncategorizedJobs: string[]
    newActionJobs: string[]
    alerts: DriftAlert[]
  } {
    const alerts: DriftAlert[] = []
    const uncategorizedJobs: string[] = []
    const newActionJobs: string[] = []

    // This would typically query the database for job templates
    // For now, check the in-memory registry
    for (const jobType of Object.keys(JOB_TYPE_CATEGORIES)) {
      if (!isJobTypeCategorized(jobType)) {
        uncategorizedJobs.push(jobType)
        alerts.push({
          jobType,
          detectedAt: new Date().toISOString(),
          category: 'uncategorized',
          severity: 'critical',
          message: `Job type ${jobType} is not categorized`,
        })
      }

      if (isActionJob(jobType)) {
        newActionJobs.push(jobType)
      }
    }

    return {
      hasDrift: alerts.length > 0,
      uncategorizedJobs,
      newActionJobs,
      alerts,
    }
  }

  /**
   * Reset drift alerts for tenant
   */
  resetDriftAlerts(tenantId: string): void {
    this.driftAlerts.delete(tenantId)
  }

  /**
   * Clear denial log for tenant
   */
  clearDenialLog(tenantId: string): void {
    this.denialLog.delete(tenantId)
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const policyGuard = new PolicyGuard()

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick check if job execution is allowed
 */
export function isJobExecutionAllowed(
  tenantId: string,
  jobType: string,
  options?: {
    projectId?: string
    policyToken?: string
    isDryRun?: boolean
  }
): boolean {
  return policyGuard.evaluateJobExecution(tenantId, jobType, options).allowed
}

/**
 * Require policy check - throws if not allowed
 */
export function requirePolicyApproval(
  tenantId: string,
  jobType: string,
  options?: {
    projectId?: string
    policyToken?: string
    isDryRun?: boolean
  }
): void {
  const decision = policyGuard.evaluateJobExecution(tenantId, jobType, options)

  if (!decision.allowed) {
    throw new Error(
      `Policy check failed for ${jobType}: ${decision.reason}. ` +
        `Required level: ${decision.requiredLevel}, ` +
        `Current level: ${decision.currentLevel}`
    )
  }
}

/**
 * Check if trigger rule is allowed to execute actions
 */
export function isTriggerRuleAllowed(rule: {
  action_mode: string
  safety_allow_action_jobs: boolean
  enabled: boolean
}): { allowed: boolean; reason: string } {
  if (!rule.enabled) {
    return { allowed: false, reason: 'Trigger rule is disabled' }
  }

  if (rule.action_mode === 'execute' && !rule.safety_allow_action_jobs) {
    return {
      allowed: false,
      reason: 'Trigger rule in execute mode must explicitly allow action jobs',
    }
  }

  if (rule.action_mode === 'execute' && !JOBFORGE_ACTION_JOBS_ENABLED) {
    return {
      allowed: false,
      reason: 'Action jobs are disabled globally',
    }
  }

  return { allowed: true, reason: 'Trigger rule approved' }
}

/**
 * Format policy report as markdown
 */
export function formatPolicyReportMarkdown(report: PolicyReport): string {
  const lines: string[] = []

  lines.push(`# Policy Report: ${report.tenantId}`)
  if (report.projectId) {
    lines.push(`## Project: ${report.projectId}`)
  }
  lines.push(`Generated: ${report.timestamp}`)
  lines.push('')

  lines.push(`## Automation Level: ${report.automationLevel}`)
  lines.push('')

  lines.push('## Allowed Job Types')
  if (report.allowedJobTypes.length === 0) {
    lines.push('*No job types currently allowed*')
  } else {
    for (const jobType of report.allowedJobTypes) {
      lines.push(`- ${jobType}`)
    }
  }
  lines.push('')

  lines.push('## Blocked Job Types')
  if (report.blockedJobTypes.length === 0) {
    lines.push('*No job types currently blocked*')
  } else {
    for (const jobType of report.blockedJobTypes) {
      lines.push(`- ${jobType}`)
    }
  }
  lines.push('')

  if (report.driftAlerts.length > 0) {
    lines.push('## ⚠️ Drift Alerts')
    for (const alert of report.driftAlerts) {
      lines.push(`- **${alert.severity.toUpperCase()}**: ${alert.message}`)
    }
    lines.push('')
  }

  if (report.recentDenials.length > 0) {
    lines.push('## Recent Denials (Last 20)')
    for (const denial of report.recentDenials) {
      lines.push(`- ${denial.timestamp}: ${denial.jobType} - ${denial.reason}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * CI validation function - call this in CI to enforce policy compliance
 */
export function validateForCI(): { passed: boolean; errors: string[] } {
  const errors: string[] = []

  // Check for uncategorized jobs
  const drift = policyGuard.detectDrift()

  if (drift.uncategorizedJobs.length > 0) {
    errors.push(
      `CI FAILURE: Uncategorized job types detected: ${drift.uncategorizedJobs.join(', ')}. ` +
        `Add these to JOB_TYPE_CATEGORIES in policy-guard.ts`
    )
  }

  // Check action job safety
  if (JOBFORGE_ACTION_JOBS_ENABLED && !JOBFORGE_REQUIRE_POLICY_TOKENS) {
    errors.push(
      'CI WARNING: JOBFORGE_ACTION_JOBS_ENABLED is set but ' +
        'JOBFORGE_REQUIRE_POLICY_TOKENS is not enforced'
    )
  }

  // Check bundle executor safety
  if (JOBFORGE_BUNDLE_EXECUTOR_ENABLED && !JOBFORGE_POLICY_GUARD_ENABLED) {
    errors.push(
      'CI WARNING: JOBFORGE_BUNDLE_EXECUTOR_ENABLED without ' +
        'JOBFORGE_POLICY_GUARD_ENABLED - governance disabled'
    )
  }

  return {
    passed: errors.length === 0,
    errors,
  }
}
