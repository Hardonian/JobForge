/**
 * JobForge Feature Flags
 * All new execution plane features are disabled by default
 */

/**
 * Get environment variable with default value
 */
function getEnvVar(name: string, defaultValue: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] ?? defaultValue
  }
  return defaultValue
}

/**
 * Parse boolean from environment variable
 */
function parseBool(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true'
}

// ============================================================================
// Execution Plane Feature Flags
// ============================================================================

/**
 * Enable event ingestion system
 * Default: false (0)
 */
export const JOBFORGE_EVENTS_ENABLED = parseBool(getEnvVar('JOBFORGE_EVENTS_ENABLED', '0'))

/**
 * Enable scheduling triggers (cron and event-driven)
 * Default: false (0)
 */
export const JOBFORGE_TRIGGERS_ENABLED = parseBool(getEnvVar('JOBFORGE_TRIGGERS_ENABLED', '0'))

/**
 * Enable autopilot job templates
 * Default: false (0)
 */
export function isAutopilotJobsEnabled(): boolean {
  return parseBool(getEnvVar('JOBFORGE_AUTOPILOT_JOBS_ENABLED', '0'))
}

// Backwards compatibility - constant evaluates at import time
export const JOBFORGE_AUTOPILOT_JOBS_ENABLED = isAutopilotJobsEnabled()

/**
 * Enable action jobs (write operations that require policy tokens)
 * Default: false (0)
 */
export function isActionJobsEnabled(): boolean {
  return parseBool(getEnvVar('JOBFORGE_ACTION_JOBS_ENABLED', '0'))
}

// Backwards compatibility - constant evaluates at import time
export const JOBFORGE_ACTION_JOBS_ENABLED = isActionJobsEnabled()

/**
 * Enable audit logging
 * Default: false (0)
 */
export const JOBFORGE_AUDIT_LOGGING_ENABLED = parseBool(
  getEnvVar('JOBFORGE_AUDIT_LOGGING_ENABLED', '0')
)

/**
 * Enable artifact manifest generation
 * Default: false (0)
 */
export const JOBFORGE_MANIFESTS_ENABLED = parseBool(getEnvVar('JOBFORGE_MANIFESTS_ENABLED', '0'))

/**
 * Enable security validation (payload limits, etc)
 * Default: true (1) - always on for safety
 */
export const JOBFORGE_SECURITY_VALIDATION_ENABLED = parseBool(
  getEnvVar('JOBFORGE_SECURITY_VALIDATION_ENABLED', '1')
)

/**
 * Enable rate limiting
 * Default: false (0)
 */
export const JOBFORGE_RATE_LIMITING_ENABLED = parseBool(
  getEnvVar('JOBFORGE_RATE_LIMITING_ENABLED', '0')
)

/**
 * Enable replay pack generation and export
 * Default: false (0)
 */
export const REPLAY_PACK_ENABLED = parseBool(getEnvVar('REPLAY_PACK_ENABLED', '0'))

/**
 * Enable ReadyLayer verify pack job type
 * Default: false (0)
 */
export const VERIFY_PACK_ENABLED = parseBool(getEnvVar('VERIFY_PACK_ENABLED', '0'))

/**
 * Enable bundle trigger rules (auto-trigger bundles from events)
 * Default: false (0)
 */
export function isBundleTriggersEnabled(): boolean {
  return parseBool(getEnvVar('JOBFORGE_BUNDLE_TRIGGERS_ENABLED', '0'))
}

export const JOBFORGE_BUNDLE_TRIGGERS_ENABLED = isBundleTriggersEnabled()

/**
 * Enable bundle executor for request bundles
 * Default: false (0)
 */
export function isBundleExecutorEnabled(): boolean {
  return parseBool(getEnvVar('JOBFORGE_BUNDLE_EXECUTOR_ENABLED', '0'))
}

export const JOBFORGE_BUNDLE_EXECUTOR_ENABLED = isBundleExecutorEnabled()

// ============================================================================
// Feature Flag Summary Updates
// ============================================================================

/**
 * Get extended feature flag summary for diagnostics
 */
export function getExtendedFeatureFlagSummary(): Record<string, boolean | string> {
  return {
    events_enabled: JOBFORGE_EVENTS_ENABLED,
    triggers_enabled: JOBFORGE_TRIGGERS_ENABLED,
    autopilot_jobs_enabled: JOBFORGE_AUTOPILOT_JOBS_ENABLED,
    action_jobs_enabled: JOBFORGE_ACTION_JOBS_ENABLED,
    audit_logging_enabled: JOBFORGE_AUDIT_LOGGING_ENABLED,
    manifests_enabled: JOBFORGE_MANIFESTS_ENABLED,
    security_validation_enabled: JOBFORGE_SECURITY_VALIDATION_ENABLED,
    rate_limiting_enabled: JOBFORGE_RATE_LIMITING_ENABLED,
    replay_pack_enabled: REPLAY_PACK_ENABLED,
    verify_pack_enabled: VERIFY_PACK_ENABLED,
    bundle_triggers_enabled: JOBFORGE_BUNDLE_TRIGGERS_ENABLED,
    bundle_executor_enabled: JOBFORGE_BUNDLE_EXECUTOR_ENABLED,
    require_policy_tokens: JOBFORGE_REQUIRE_POLICY_TOKENS,
    policy_token_secret_set: JOBFORGE_POLICY_TOKEN_SECRET.length > 0,
  }
}

// ============================================================================
// Policy Token Settings
// ============================================================================

/**
 * Policy token secret for HMAC signing
 * MUST be set in production when action jobs are enabled
 */
export const JOBFORGE_POLICY_TOKEN_SECRET = getEnvVar('JOBFORGE_POLICY_TOKEN_SECRET', '')

/**
 * Default policy token expiration in hours
 * Default: 1 hour
 */
export const JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS = parseInt(
  getEnvVar('JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS', '1'),
  10
)

/**
 * Require policy tokens for all action jobs
 * Default: true (1) when action jobs are enabled
 */
export const JOBFORGE_REQUIRE_POLICY_TOKENS = parseBool(
  getEnvVar('JOBFORGE_REQUIRE_POLICY_TOKENS', '1')
)

// ============================================================================
// Safety Checks
// ============================================================================

/**
 * Verify that action jobs are properly gated
 * Throws if action jobs are enabled without required safeguards
 */
export function verifyActionJobSafety(): void {
  if (!JOBFORGE_ACTION_JOBS_ENABLED) {
    return // Not enabled, no check needed
  }

  // Action jobs are enabled - verify safeguards
  if (JOBFORGE_REQUIRE_POLICY_TOKENS && !JOBFORGE_POLICY_TOKEN_SECRET) {
    throw new Error(
      'JOBFORGE_ACTION_JOBS_ENABLED requires JOBFORGE_POLICY_TOKEN_SECRET to be set. ' +
        'Action jobs are write operations and MUST have policy token verification enabled.'
    )
  }
}

/**
 * Check if a specific autopilot template is enabled
 * Template must be enabled in DB AND autopilot jobs feature must be on
 */
export function isTemplateEnabled(templateEnabled: boolean): boolean {
  return JOBFORGE_AUTOPILOT_JOBS_ENABLED && templateEnabled
}

/**
 * Check if event ingestion is available
 */
export function isEventIngestionAvailable(): boolean {
  return JOBFORGE_EVENTS_ENABLED
}

/**
 * Check if audit logging is available
 */
export function isAuditLoggingAvailable(): boolean {
  return JOBFORGE_AUDIT_LOGGING_ENABLED
}

/**
 * Check if manifest generation is available
 */
export function isManifestGenerationAvailable(): boolean {
  return JOBFORGE_MANIFESTS_ENABLED
}

/**
 * Enable observability features (structured logging, trace correlation)
 * Default: false (0) - disabled by default for backwards compatibility
 */
export const OBS_ENABLED = parseBool(getEnvVar('OBS_ENABLED', '0'))

/**
 * Get feature flag summary for diagnostics
 */
export function getFeatureFlagSummary(): Record<string, boolean | string> {
  return {
    events_enabled: JOBFORGE_EVENTS_ENABLED,
    triggers_enabled: JOBFORGE_TRIGGERS_ENABLED,
    autopilot_jobs_enabled: JOBFORGE_AUTOPILOT_JOBS_ENABLED,
    action_jobs_enabled: JOBFORGE_ACTION_JOBS_ENABLED,
    audit_logging_enabled: JOBFORGE_AUDIT_LOGGING_ENABLED,
    manifests_enabled: JOBFORGE_MANIFESTS_ENABLED,
    require_policy_tokens: JOBFORGE_REQUIRE_POLICY_TOKENS,
    policy_token_secret_set: JOBFORGE_POLICY_TOKEN_SECRET.length > 0,
    obs_enabled: OBS_ENABLED,
  }
}
