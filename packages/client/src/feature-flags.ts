/**
 * @jobforge/client - Feature flags
 * All integration features are disabled by default
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

/**
 * Enable JobForge integration client
 * Default: false (0) - must be explicitly enabled
 */
export const JOBFORGE_INTEGRATION_ENABLED = parseBool(
  getEnvVar('JOBFORGE_INTEGRATION_ENABLED', '0')
)

/**
 * Enable DRY_RUN mode for testing (no side effects)
 * Default: true (1) when integration is disabled
 */
export const JOBFORGE_DRY_RUN_MODE = parseBool(
  getEnvVar('JOBFORGE_DRY_RUN_MODE', JOBFORGE_INTEGRATION_ENABLED ? '0' : '1')
)

/**
 * HTTP API endpoint for JobForge (optional)
 * If not set, uses direct SDK transport
 */
export const JOBFORGE_API_ENDPOINT = getEnvVar('JOBFORGE_API_ENDPOINT', '')

/**
 * API key for HTTP transport (if using HTTP endpoint)
 */
export const JOBFORGE_API_KEY = getEnvVar('JOBFORGE_API_KEY', '')

/**
 * Check if integration is available
 */
export function isIntegrationEnabled(): boolean {
  return JOBFORGE_INTEGRATION_ENABLED
}

/**
 * Check if dry run mode is active
 */
export function isDryRunMode(): boolean {
  return JOBFORGE_DRY_RUN_MODE
}

/**
 * Get feature flag summary for diagnostics
 */
export function getFeatureFlagSummary(): Record<string, boolean | string> {
  return {
    integration_enabled: JOBFORGE_INTEGRATION_ENABLED,
    dry_run_mode: JOBFORGE_DRY_RUN_MODE,
    api_endpoint_set: JOBFORGE_API_ENDPOINT.length > 0,
    api_key_set: JOBFORGE_API_KEY.length > 0,
    api_endpoint: JOBFORGE_API_ENDPOINT || '(not set)',
  }
}

/**
 * Verify that integration can be used
 * Throws if integration is not enabled and not in dry run mode
 */
export function verifyIntegrationAvailable(): void {
  if (!JOBFORGE_INTEGRATION_ENABLED && !JOBFORGE_DRY_RUN_MODE) {
    throw new Error(
      'JobForge integration is disabled. ' +
        'Set JOBFORGE_INTEGRATION_ENABLED=1 to enable, ' +
        'or JOBFORGE_DRY_RUN_MODE=1 for testing.'
    )
  }
}
