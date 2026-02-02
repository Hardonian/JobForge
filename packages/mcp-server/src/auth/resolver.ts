/**
 * MCP Server Auth Resolver
 * Resolves authentication tokens to actor contexts
 */

import { randomUUID } from 'crypto'
import { createHmac, timingSafeEqual } from 'crypto'
import type {
  ActorContext,
  AuthResolution,
  PolicyTokenPayload,
  PolicyTokenValidation,
} from '../types'
import {
  MCP_DEV_MODE,
  MCP_POLICY_TOKEN_SECRET,
  MCP_POLICY_TOKEN_EXPIRY_HOURS,
} from '../feature-flags'

// ============================================================================
// Constants
// ============================================================================

const DEV_ACTOR_ID = 'dev-actor'
const DEV_TENANT_ID = '00000000-0000-0000-0000-000000000000'

// ============================================================================
// Auth Resolver
// ============================================================================

/**
 * Resolve authentication from request context
 * Supports: dev mode, bearer tokens, policy tokens
 */
export async function resolveAuth(
  authHeader?: string,
  tenantId?: string,
  projectId?: string
): Promise<AuthResolution> {
  // Dev mode: allow unauthenticated with dev actor
  if (MCP_DEV_MODE && !authHeader) {
    return {
      success: true,
      actor: createDevActor(tenantId, projectId),
    }
  }

  // No auth provided and not in dev mode
  if (!authHeader) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required. Provide Authorization header or enable MCP_DEV_MODE.',
      },
    }
  }

  // Parse bearer token
  const token = parseBearerToken(authHeader)
  if (!token) {
    return {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid Authorization header format. Expected: Bearer <token>',
      },
    }
  }

  // Try policy token first
  const policyValidation = validatePolicyToken(token)
  if (policyValidation.valid && policyValidation.payload) {
    return {
      success: true,
      actor: policyTokenToActor(policyValidation.payload),
    }
  }

  // If it looks like a policy token but failed validation
  if (token.startsWith('pt_')) {
    return {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: policyValidation.error?.message || 'Invalid policy token',
      },
    }
  }

  // Regular JWT token (would integrate with Supabase or other JWT provider)
  // For now, return unauthorized - production should implement JWT validation
  return {
    success: false,
    error: {
      code: 'INVALID_TOKEN',
      message:
        'Token type not recognized. Only policy tokens (pt_*) are supported in this version.',
    },
  }
}

/**
 * Create dev actor for local development
 */
function createDevActor(tenantId?: string, projectId?: string): ActorContext {
  return {
    actorId: DEV_ACTOR_ID,
    tenantId: tenantId || DEV_TENANT_ID,
    projectId,
    scopes: [
      'jobs:read',
      'jobs:run',
      'jobs:write',
      'connectors:read',
      'connectors:test',
      'artifacts:read',
      'artifacts:write',
      'readylayer:read',
      'readylayer:verify',
    ],
    authMethod: 'dev',
    isServiceAccount: false,
  }
}

/**
 * Parse bearer token from header
 */
function parseBearerToken(header: string): string | null {
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1] || null
}

// ============================================================================
// Policy Token Implementation
// ============================================================================

// Simple in-memory used token store (for single_use tokens)
// Production should use Redis or database
const usedTokens = new Set<string>()

/**
 * Generate a policy token for write operations
 */
export function generatePolicyToken(
  actorId: string,
  tenantId: string,
  scopes: string[],
  options: {
    projectId?: string
    expiresInHours?: number
    allowedTools?: string[]
    singleUse?: boolean
  } = {}
): string {
  if (!MCP_POLICY_TOKEN_SECRET) {
    throw new Error('MCP_POLICY_TOKEN_SECRET not configured')
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + (options.expiresInHours || MCP_POLICY_TOKEN_EXPIRY_HOURS) * 3600

  const payload: PolicyTokenPayload = {
    jti: randomUUID(),
    sub: actorId,
    tenant_id: tenantId,
    project_id: options.projectId,
    scopes,
    iat: now,
    exp,
    type: 'policy',
    allowed_tools: options.allowedTools,
    single_use: options.singleUse,
  }

  // Base64 encode payload
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/=+$/, '')

  // Create signature
  const signature = createHmac('sha256', MCP_POLICY_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64')
    .replace(/=+$/, '')

  // Token format: pt_<payload>_<signature>
  return `pt_${payloadB64}_${signature}`
}

/**
 * Validate a policy token
 */
export function validatePolicyToken(token: string): PolicyTokenValidation {
  // Check if already used (single-use tokens)
  if (usedTokens.has(token)) {
    return {
      valid: false,
      error: {
        code: 'ALREADY_USED',
        message: 'Policy token has already been used',
      },
    }
  }

  // Check format
  if (!token.startsWith('pt_')) {
    return { valid: false }
  }

  const parts = token.split('_')
  if (parts.length !== 3) {
    return {
      valid: false,
      error: {
        code: 'INVALID_FORMAT',
        message: 'Invalid policy token format',
      },
    }
  }

  const [, payloadB64, signature] = parts

  // Verify signature
  if (!verifyTokenSignature(payloadB64, signature)) {
    return {
      valid: false,
      error: {
        code: 'INVALID_SIGNATURE',
        message: 'Invalid policy token signature',
      },
    }
  }

  // Decode payload
  let payload: PolicyTokenPayload
  try {
    const payloadJson = Buffer.from(payloadB64, 'base64').toString('utf-8')
    payload = JSON.parse(payloadJson)
  } catch {
    return {
      valid: false,
      error: {
        code: 'INVALID_FORMAT',
        message: 'Invalid policy token payload',
      },
    }
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000)
  if (payload.exp < now) {
    return {
      valid: false,
      error: {
        code: 'EXPIRED',
        message: 'Policy token has expired',
      },
    }
  }

  // Mark as used if single-use
  if (payload.single_use) {
    usedTokens.add(token)
  }

  return { valid: true, payload }
}

/**
 * Verify token signature using constant-time comparison
 */
function verifyTokenSignature(payloadB64: string, signature: string): boolean {
  if (!MCP_POLICY_TOKEN_SECRET) {
    return false
  }

  const expected = createHmac('sha256', MCP_POLICY_TOKEN_SECRET)
    .update(payloadB64)
    .digest('base64')
    .replace(/=+$/, '')

  try {
    // Constant-time comparison to prevent timing attacks
    const expectedBuf = Buffer.from(expected)
    const actualBuf = Buffer.from(signature)

    if (expectedBuf.length !== actualBuf.length) {
      return false
    }

    return timingSafeEqual(expectedBuf, actualBuf)
  } catch {
    return false
  }
}

/**
 * Convert policy token payload to actor context
 */
function policyTokenToActor(payload: PolicyTokenPayload): ActorContext {
  return {
    actorId: payload.sub,
    tenantId: payload.tenant_id,
    projectId: payload.project_id,
    scopes: payload.scopes,
    authMethod: 'policy_token',
    isServiceAccount: true,
  }
}

/**
 * Clear used tokens (for testing)
 */
export function clearUsedPolicyTokens(): void {
  usedTokens.clear()
}
