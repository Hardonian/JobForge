/**
 * JobForge Integration Feature Flags
 *
 * All integration features are disabled by default.
 * Set JOBFORGE_INTEGRATION_ENABLED=1 to enable.
 */

/**
 * Get environment variable with default value
 */
function getEnvVar(name: string, defaultValue: string): string
function getEnvVar(name: string, defaultValue: undefined): string | undefined
function getEnvVar(name: string, defaultValue: string | undefined): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] ?? defaultValue
  }
  return defaultValue
}

/**
 * Parse boolean from environment variable
 */
function parseBool(value?: string): boolean {
  if (!value) return false
  return value === '1' || value.toLowerCase() === 'true'
}

/**
 * Master integration enablement flag
 * Default: false (0) - must be explicitly enabled per app
 */
export const JOBFORGE_INTEGRATION_ENABLED = parseBool(
  getEnvVar('JOBFORGE_INTEGRATION_ENABLED', '0')
)

/**
 * Enable dry-run mode for testing
 * When enabled, job requests use dry_run=true by default
 */
export const JOBFORGE_INTEGRATION_DRY_RUN = parseBool(
  getEnvVar('JOBFORGE_INTEGRATION_DRY_RUN', '1')
)

/**
 * Tenant mapping configuration
 * Format: "app:tenant_id,app2:tenant_id2"
 * Example: "settler:uuid1,keys:uuid2"
 */
export function getTenantMapping(app: string): string | undefined {
  const mapping = getEnvVar('JOBFORGE_TENANT_MAPPING', '')
  if (!mapping) return undefined

  const pairs = mapping.split(',')
  for (const pair of pairs) {
    const [key, value] = pair.split(':')
    if (key.trim() === app) {
      return value.trim()
    }
  }
  return undefined
}

/**
 * Project mapping configuration
 * Format: "app:project_id,app2:project_id2"
 */
export function getProjectMapping(app: string): string | undefined {
  const mapping = getEnvVar('JOBFORGE_PROJECT_MAPPING', '')
  if (!mapping) return undefined

  const pairs = mapping.split(',')
  for (const pair of pairs) {
    const [key, value] = pair.split(':')
    if (key.trim() === app) {
      return value.trim()
    }
  }
  return undefined
}

/**
 * Get Supabase configuration for integration
 */
export function getIntegrationConfig(): {
  supabaseUrl: string | undefined
  supabaseKey: string | undefined
} {
  return {
    supabaseUrl: getEnvVar('SUPABASE_URL', undefined),
    supabaseKey: getEnvVar('SUPABASE_SERVICE_ROLE_KEY', undefined),
  }
}

/**
 * Check if integration is enabled for a specific app
 */
export function isIntegrationEnabled(app: string): boolean {
  if (!JOBFORGE_INTEGRATION_ENABLED) {
    return false
  }

  // Check app-specific override
  const appSpecific = getEnvVar(`JOBFORGE_${app.toUpperCase()}_ENABLED`, '')
  if (appSpecific) {
    return parseBool(appSpecific)
  }

  return true
}

/**
 * Get feature flag summary for diagnostics
 */
export function getIntegrationFlagSummary(): Record<string, boolean | string | undefined> {
  return {
    integration_enabled: JOBFORGE_INTEGRATION_ENABLED,
    dry_run_default: JOBFORGE_INTEGRATION_DRY_RUN,
    supabase_url_set: !!getEnvVar('SUPABASE_URL', ''),
    supabase_key_set: !!getEnvVar('SUPABASE_SERVICE_ROLE_KEY', ''),
    tenant_mapping: getEnvVar('JOBFORGE_TENANT_MAPPING', ''),
    project_mapping: getEnvVar('JOBFORGE_PROJECT_MAPPING', ''),
  }
}
