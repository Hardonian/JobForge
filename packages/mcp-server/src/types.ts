/**
 * MCP Server Types
 * Core types for the MCP server implementation
 */

import type { z } from 'zod'

// ============================================================================
// Actor/Auth Types
// ============================================================================

/**
 * Resolved actor context from authentication
 */
export interface ActorContext {
  /** Unique actor identifier */
  actorId: string
  /** Tenant scope */
  tenantId: string
  /** Optional project scope */
  projectId?: string
  /** Granted scopes for this actor */
  scopes: string[]
  /** Authentication method used */
  authMethod: 'token' | 'policy_token' | 'dev'
  /** Whether this is a service account */
  isServiceAccount?: boolean
}

/**
 * Authentication result
 */
export interface AuthResult {
  success: true
  actor: ActorContext
}

export interface AuthError {
  success: false
  error: {
    code: 'UNAUTHORIZED' | 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'MISSING_SCOPES'
    message: string
    missingScopes?: string[]
  }
}

export type AuthResolution = AuthResult | AuthError

// ============================================================================
// Tool Types
// ============================================================================

/**
 * Tool handler function type
 */
export type ToolHandler<TInput = unknown, TOutput = unknown> = (
  args: TInput,
  context: ToolContext
) => Promise<ToolResult<TOutput>>

/**
 * Context passed to every tool handler
 */
export interface ToolContext {
  /** Actor making the request */
  actor: ActorContext
  /** Unique trace ID for this request */
  traceId: string
  /** Tool name being invoked */
  toolName: string
  /** Timestamp when request started */
  startedAt: Date
  /** Feature flag overrides for this request */
  featureFlags?: Record<string, boolean>
}

/**
 * Standard tool result wrapper
 */
export interface ToolResult<TOutput = unknown> {
  /** Whether the operation succeeded */
  success: boolean
  /** Result data (if success) */
  data?: TOutput
  /** Error information (if failure) */
  error?: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
  /** Additional metadata */
  meta?: {
    traceId: string
    durationMs: number
    auditLogId?: string
  }
}

/**
 * Tool definition for registration
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  /** Tool name (namespaced like jobforge.jobs.create) */
  name: string
  /** Human-readable description */
  description: string
  /** Input schema (Zod) */
  inputSchema: z.ZodTypeAny | z.ZodObject<z.ZodRawShape>
  /** Output schema (Zod, for validation) */
  outputSchema?: z.ZodTypeAny | z.ZodObject<z.ZodRawShape>
  /** Required scopes to invoke this tool */
  requiredScopes: string[]
  /** Whether this is a write operation */
  isWrite: boolean
  /** Whether this requires a policy token */
  requiresPolicyToken: boolean
  /** Rate limit override (uses default if not specified) */
  rateLimit?: {
    max: number
    windowMs: number
  }
  /** Handler implementation */
  handler: ToolHandler<TInput, TOutput>
}

// ============================================================================
// Audit Types
// ============================================================================

/**
 * MCP audit log entry
 */
export interface McpAuditLogEntry {
  id: string
  timestamp: string
  traceId: string
  toolName: string
  actorId: string
  tenantId: string
  projectId?: string
  decision: 'allow' | 'deny' | 'error'
  reason?: string
  durationMs: number
  inputSummary?: Record<string, unknown>
  outputSummary?: Record<string, unknown>
  errorSummary?: Record<string, unknown>
  scopesChecked: string[]
  rateLimitHit?: boolean
}

// ============================================================================
// Feature Flag Types
// ============================================================================

/**
 * Tool availability status
 */
export interface ToolAvailability {
  available: boolean
  reason?: string
  requiresFlag?: string
  isWrite?: boolean
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * MCP Server error codes
 */
export type McpErrorCode =
  | 'MCP_DISABLED'
  | 'TOOL_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'POLICY_TOKEN_REQUIRED'
  | 'POLICY_TOKEN_INVALID'
  | 'WRITE_DISABLED'
  | 'PR_DISABLED'
  | 'READYLAYER_DISABLED'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED'
  | 'TOOL_UNAVAILABLE'

/**
 * MCP Server error
 */
export class McpServerError extends Error {
  constructor(
    public code: McpErrorCode,
    message: string,
    public details?: Record<string, unknown>,
    public cause?: unknown
  ) {
    super(message)
    this.name = 'McpServerError'
  }
}

// ============================================================================
// Policy Token Types
// ============================================================================

/**
 * Policy token payload
 */
export interface PolicyTokenPayload {
  /** Token ID */
  jti: string
  /** Actor ID */
  sub: string
  /** Tenant ID */
  tenant_id: string
  /** Project ID (optional) */
  project_id?: string
  /** Granted scopes */
  scopes: string[]
  /** Token issuance time */
  iat: number
  /** Token expiration time */
  exp: number
  /** Token type */
  type: 'policy'
  /** Allowed tools (optional restriction) */
  allowed_tools?: string[]
  /** Single-use token flag */
  single_use?: boolean
}

/**
 * Policy token validation result
 */
export interface PolicyTokenValidation {
  valid: boolean
  payload?: PolicyTokenPayload
  error?: {
    code: 'EXPIRED' | 'INVALID_SIGNATURE' | 'INVALID_FORMAT' | 'ALREADY_USED'
    message: string
  }
}
