/**
 * MCP Server Feature Flags
 * All MCP features are disabled by default for safety
 */

function getEnvVar(name: string, defaultValue: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] ?? defaultValue
  }
  return defaultValue
}

function parseBool(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true'
}

// ============================================================================
// MCP Server Master Switches
// ============================================================================

/**
 * Enable MCP server entirely
 * Default: false (0)
 */
export const MCP_ENABLED = parseBool(getEnvVar('MCP_ENABLED', '0'))

/**
 * Enable write operations via MCP
 * Default: false (0) - read-only by default
 */
export const MCP_WRITE_ENABLED = parseBool(getEnvVar('MCP_WRITE_ENABLED', '0'))

/**
 * Enable PR operations (propose, apply, open)
 * Default: false (0)
 */
export const MCP_PR_ENABLED = parseBool(getEnvVar('MCP_PR_ENABLED', '0'))

/**
 * Enable ReadyLayer governance tools
 * Default: false (0)
 */
export const MCP_READYLAYER_ENABLED = parseBool(getEnvVar('MCP_READYLAYER_ENABLED', '0'))

/**
 * Enable audit logging for MCP calls
 * Default: true (1) - audit is on by default for security
 */
export const MCP_AUDIT_ENABLED = parseBool(getEnvVar('MCP_AUDIT_ENABLED', '1'))

/**
 * Enable dev mode (include stack traces in errors)
 * Default: false (0)
 */
export const MCP_DEV_MODE = parseBool(getEnvVar('MCP_DEV_MODE', '0'))

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

/**
 * MCP rate limit window in milliseconds
 * Default: 60000 (1 minute)
 */
export const MCP_RATE_LIMIT_WINDOW_MS = parseInt(getEnvVar('MCP_RATE_LIMIT_WINDOW_MS', '60000'), 10)

/**
 * MCP rate limit max requests per window
 * Default: 100
 */
export const MCP_RATE_LIMIT_MAX = parseInt(getEnvVar('MCP_RATE_LIMIT_MAX', '100'), 10)

/**
 * Per-tool rate limits (override defaults)
 */
export const MCP_TOOL_RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  'jobforge.jobs.create': { max: 10, windowMs: 60000 },
  'jobforge.jobs.run': { max: 10, windowMs: 60000 },
  'jobforge.jobs.cancel': { max: 5, windowMs: 60000 },
  'readylayer.pr.apply_patchset': { max: 2, windowMs: 300000 }, // 5 min window for writes
  'readylayer.pr.open': { max: 1, windowMs: 600000 }, // 10 min window for PRs
}

// ============================================================================
// Policy Token Configuration
// ============================================================================

/**
 * Require policy tokens for write operations
 * Default: true (1)
 */
export const MCP_REQUIRE_POLICY_TOKENS = parseBool(getEnvVar('MCP_REQUIRE_POLICY_TOKENS', '1'))

/**
 * Policy token secret for HMAC signing
 * Should be set in production
 */
export const MCP_POLICY_TOKEN_SECRET = getEnvVar('MCP_POLICY_TOKEN_SECRET', '')

/**
 * Policy token expiration in hours
 * Default: 1 hour
 */
export const MCP_POLICY_TOKEN_EXPIRY_HOURS = parseInt(
  getEnvVar('MCP_POLICY_TOKEN_EXPIRY_HOURS', '1'),
  10
)

// ============================================================================
// Safety Checks
// ============================================================================

/**
 * Verify MCP safety configuration
 * Throws if unsafe configuration detected
 */
export function verifyMcpSafety(): void {
  if (!MCP_ENABLED) {
    return // Not enabled, no checks needed
  }

  // If write operations are enabled, verify policy token secret is set
  if (MCP_WRITE_ENABLED && MCP_REQUIRE_POLICY_TOKENS && !MCP_POLICY_TOKEN_SECRET) {
    throw new Error(
      'MCP_WRITE_ENABLED requires MCP_POLICY_TOKEN_SECRET to be set. ' +
        'Write operations must be protected by policy tokens.'
    )
  }

  // If PR operations are enabled, verify write is also enabled
  if (MCP_PR_ENABLED && !MCP_WRITE_ENABLED) {
    throw new Error('MCP_PR_ENABLED requires MCP_WRITE_ENABLED to also be enabled.')
  }
}

// ============================================================================
// Feature Flag Summary
// ============================================================================

/**
 * Get MCP feature flag summary for diagnostics
 */
export function getMcpFeatureFlagSummary(): Record<string, boolean | number | string> {
  return {
    enabled: MCP_ENABLED,
    write_enabled: MCP_WRITE_ENABLED,
    pr_enabled: MCP_PR_ENABLED,
    readylayer_enabled: MCP_READYLAYER_ENABLED,
    audit_enabled: MCP_AUDIT_ENABLED,
    dev_mode: MCP_DEV_MODE,
    rate_limit_window_ms: MCP_RATE_LIMIT_WINDOW_MS,
    rate_limit_max: MCP_RATE_LIMIT_MAX,
    require_policy_tokens: MCP_REQUIRE_POLICY_TOKENS,
    policy_token_secret_set: MCP_POLICY_TOKEN_SECRET.length > 0,
  }
}
