/**
 * JobForge Policy Token System with HMAC Verification
 * Secure policy tokens for action job authorization
 *
 * Security Model:
 * - Tokens are HMAC-SHA256 signed with a server-side secret
 * - Tokens contain claims (tenant, project, scopes, expiration)
 * - Tokens are URL-safe base64 encoded
 * - No state stored server-side (self-contained tokens)
 * - Short expiration (default 1 hour)
 * - One-time use recommended for action jobs
 */

import { createHmac, timingSafeEqual } from 'crypto'
import { z } from 'zod'

// ============================================================================
// Token Schema
// ============================================================================

export const PolicyTokenPayloadSchema = z.object({
  /** Token ID for tracking/revocation */
  jti: z.string().uuid(),
  /** Token version for migration handling */
  ver: z.literal('1'),
  /** Issued at timestamp (Unix seconds) */
  iat: z.number().int().positive(),
  /** Expiration timestamp (Unix seconds) */
  exp: z.number().int().positive(),
  /** Tenant ID */
  tid: z.string().uuid(),
  /** Project ID (optional) */
  pid: z.string().uuid().optional(),
  /** Actor ID (who requested the token) */
  act: z.string().min(1),
  /** Scopes granted */
  scp: z.array(z.string()).min(1),
  /** Action being authorized */
  aud: z.string().min(1),
  /** Resource being acted upon (optional) */
  res: z.string().optional(),
  /** Token context data (optional) */
  ctx: z.record(z.unknown()).optional(),
})

export type PolicyTokenPayload = z.infer<typeof PolicyTokenPayloadSchema>

export interface PolicyTokenVerificationResult {
  valid: boolean
  token?: PolicyTokenPayload
  error?: string
  claims?: {
    tenantId: string
    projectId?: string
    actorId: string
    scopes: string[]
    action: string
    resource?: string
  }
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generate a policy token
 */
export function generatePolicyToken(
  params: {
    tenantId: string
    projectId?: string
    actorId: string
    scopes: string[]
    action: string
    resource?: string
    context?: Record<string, unknown>
    expiresInSeconds?: number
  },
  secret: string
): string {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + (params.expiresInSeconds || 3600) // Default 1 hour

  const payload: PolicyTokenPayload = {
    jti: crypto.randomUUID(),
    ver: '1',
    iat: now,
    exp,
    tid: params.tenantId,
    pid: params.projectId,
    act: params.actorId,
    scp: params.scopes,
    aud: params.action,
    res: params.resource,
    ctx: params.context,
  }

  // Encode payload
  const payloadJson = JSON.stringify(payload)
  const payloadBase64 = Buffer.from(payloadJson).toString('base64url').replace(/=/g, '')

  // Generate HMAC signature
  const signature = createHmac('sha256', secret)
    .update(payloadBase64)
    .digest('base64url')
    .replace(/=/g, '')

  // Combine: payload.signature
  return `${payloadBase64}.${signature}`
}

// ============================================================================
// Token Verification
// ============================================================================

/**
 * Verify a policy token
 *
 * Security features:
 * - Constant-time signature comparison (timing attack resistant)
 * - Schema validation
 * - Expiration check
 * - Secret rotation support (can pass multiple secrets)
 */
export function verifyPolicyToken(
  token: string,
  secretOrSecrets: string | string[],
  options?: {
    /** Require specific action */
    requiredAction?: string
    /** Require specific tenant */
    requiredTenantId?: string
    /** Require specific project */
    requiredProjectId?: string
    /** Require specific scopes */
    requiredScopes?: string[]
    /** Clock skew tolerance in seconds (default: 60) */
    clockSkewSeconds?: number
  }
): PolicyTokenVerificationResult {
  try {
    // Split token
    const parts = token.split('.')
    if (parts.length !== 2) {
      return { valid: false, error: 'Invalid token format' }
    }

    const [payloadBase64, signature] = parts

    // Decode payload
    let payload: PolicyTokenPayload
    try {
      const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf-8')
      const parsed = JSON.parse(payloadJson)
      payload = PolicyTokenPayloadSchema.parse(parsed)
    } catch (error) {
      return { valid: false, error: 'Invalid token payload' }
    }

    // Verify expiration
    const now = Math.floor(Date.now() / 1000)
    const clockSkew = options?.clockSkewSeconds || 60
    if (payload.exp < now - clockSkew) {
      return { valid: false, error: 'Token expired' }
    }

    // Verify not issued in future (with clock skew tolerance)
    if (payload.iat > now + clockSkew) {
      return { valid: false, error: 'Token issued in future' }
    }

    // Verify signature with constant-time comparison
    const secrets = Array.isArray(secretOrSecrets) ? secretOrSecrets : [secretOrSecrets]
    let signatureValid = false

    for (const secret of secrets) {
      const expectedSignature = createHmac('sha256', secret).update(payloadBase64).digest()

      const providedSignature = Buffer.from(signature, 'base64url')

      // Constant-time comparison to prevent timing attacks
      if (expectedSignature.length === providedSignature.length) {
        try {
          if (timingSafeEqual(expectedSignature, providedSignature)) {
            signatureValid = true
            break
          }
        } catch {
          // Length mismatch or other error, continue to next secret
        }
      }
    }

    if (!signatureValid) {
      return { valid: false, error: 'Invalid signature' }
    }

    // Verify required action
    if (options?.requiredAction && payload.aud !== options.requiredAction) {
      return {
        valid: false,
        error: `Token action mismatch: expected ${options.requiredAction}, got ${payload.aud}`,
      }
    }

    // Verify required tenant
    if (options?.requiredTenantId && payload.tid !== options.requiredTenantId) {
      return { valid: false, error: 'Token tenant mismatch' }
    }

    // Verify required project
    if (options?.requiredProjectId && payload.pid !== options.requiredProjectId) {
      return { valid: false, error: 'Token project mismatch' }
    }

    // Verify required scopes
    if (options?.requiredScopes && options.requiredScopes.length > 0) {
      const hasAllScopes = options.requiredScopes.every((scope) => payload.scp.includes(scope))
      if (!hasAllScopes) {
        const missing = options.requiredScopes.filter((scope) => !payload.scp.includes(scope))
        return { valid: false, error: `Missing required scopes: ${missing.join(', ')}` }
      }
    }

    return {
      valid: true,
      token: payload,
      claims: {
        tenantId: payload.tid,
        projectId: payload.pid,
        actorId: payload.act,
        scopes: payload.scp,
        action: payload.aud,
        resource: payload.res,
      },
    }
  } catch (error) {
    return {
      valid: false,
      error: `Token verification failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

// ============================================================================
// Token Parsing (without verification - for debugging only)
// ============================================================================

/**
 * Parse a policy token without verifying signature
 * WARNING: Only use this for debugging/admin purposes
 */
export function parsePolicyTokenUnsafe(token: string): PolicyTokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 2) return null

    const payloadJson = Buffer.from(parts[0], 'base64url').toString('utf-8')
    return PolicyTokenPayloadSchema.parse(JSON.parse(payloadJson))
  } catch {
    return null
  }
}

// ============================================================================
// Token Validation Helpers
// ============================================================================

/**
 * Check if a token is expired (without full verification)
 */
export function isTokenExpired(token: string, clockSkewSeconds = 60): boolean {
  const payload = parsePolicyTokenUnsafe(token)
  if (!payload) return true

  const now = Math.floor(Date.now() / 1000)
  return payload.exp < now - clockSkewSeconds
}

/**
 * Get token expiration time
 */
export function getTokenExpiration(token: string): Date | null {
  const payload = parsePolicyTokenUnsafe(token)
  if (!payload) return null
  return new Date(payload.exp * 1000)
}

/**
 * Get token time remaining in seconds
 */
export function getTokenTimeRemaining(token: string): number {
  const payload = parsePolicyTokenUnsafe(token)
  if (!payload) return 0

  const now = Math.floor(Date.now() / 1000)
  return Math.max(0, payload.exp - now)
}

// ============================================================================
// Policy Token Middleware Helper
// ============================================================================

export interface PolicyValidationOptions {
  secret: string | string[]
  requiredAction: string
  requiredScopes?: string[]
  requiredTenantId?: string
  requiredProjectId?: string
}

/**
 * Validate policy token for action jobs
 * This is the main function to use in bundle executor
 */
export function validatePolicyTokenForAction(
  token: string | undefined,
  options: PolicyValidationOptions
): { valid: boolean; reason?: string; claims?: PolicyTokenVerificationResult['claims'] } {
  if (!token) {
    return { valid: false, reason: 'Policy token required for action jobs' }
  }

  const result = verifyPolicyToken(token, options.secret, {
    requiredAction: options.requiredAction,
    requiredScopes: options.requiredScopes,
    requiredTenantId: options.requiredTenantId,
    requiredProjectId: options.requiredProjectId,
  })

  if (!result.valid) {
    return { valid: false, reason: result.error }
  }

  return {
    valid: true,
    claims: result.claims,
  }
}

// ============================================================================
// Legacy Token Compatibility (for migration)
// ============================================================================

/**
 * Verify legacy format token (pre-v1)
 * Only for backwards compatibility during migration
 */
export function verifyLegacyPolicyToken(
  token: string,
  secret: string
): PolicyTokenVerificationResult {
  try {
    // Legacy format: simple HMAC of token data
    const signature = createHmac('sha256', secret).update(token).digest('hex')

    // Legacy tokens don't have structure - just check length
    if (token.length < 32) {
      return { valid: false, error: 'Legacy token too short' }
    }

    // In production, you would verify against stored token hashes
    // This is a placeholder for migration logic
    return {
      valid: false,
      error: 'Legacy token format no longer supported. Please generate new v1 token.',
    }
  } catch (error) {
    return {
      valid: false,
      error: `Legacy verification failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
