/**
 * Observability Feature Flags
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
 * Enable observability features
 * Default: false (0) - disabled by default for backwards compatibility
 */
export const OBS_ENABLED = parseBool(getEnvVar('OBS_ENABLED', '0'))

/**
 * Enable debug-level logging
 * Default: false (0)
 */
export const OBS_DEBUG = parseBool(getEnvVar('OBS_DEBUG', '0'))

/**
 * Service name override
 * Auto-detected from package name if not set
 */
export const SERVICE_NAME = getEnvVar('SERVICE_NAME', '')

/**
 * Environment name
 * Falls back to NODE_ENV, VERCEL_ENV, or 'local'
 */
export const OBS_ENV = getEnvVar('ENV', getEnvVar('NODE_ENV', getEnvVar('VERCEL_ENV', 'local')))

/**
 * Custom redaction fields (comma-separated)
 * Additional fields to redact beyond defaults
 */
export const OBS_REDACT_FIELDS = getEnvVar('OBS_REDACT_FIELDS', '')
  .split(',')
  .map((f) => f.trim())
  .filter((f) => f.length > 0)

/**
 * Get observability configuration summary
 */
export function getObservabilityConfig(): {
  enabled: boolean
  debug: boolean
  serviceName: string
  env: string
  customRedactFields: string[]
} {
  return {
    enabled: OBS_ENABLED,
    debug: OBS_DEBUG,
    serviceName: SERVICE_NAME,
    env: OBS_ENV,
    customRedactFields: OBS_REDACT_FIELDS,
  }
}
