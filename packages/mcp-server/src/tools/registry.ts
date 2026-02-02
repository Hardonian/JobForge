/**
 * MCP Server Tool Registry
 * Registers and manages all MCP tools with security enforcement
 */

import { z } from 'zod'
import type { ToolDefinition, ToolContext, ToolResult, ToolAvailability } from '../types'
import { McpServerError } from '../types'
import {
  MCP_ENABLED,
  MCP_WRITE_ENABLED,
  MCP_PR_ENABLED,
  MCP_READYLAYER_ENABLED,
  MCP_RATE_LIMIT_MAX,
  MCP_RATE_LIMIT_WINDOW_MS,
} from '../feature-flags'
import { checkRateLimit, checkScopes } from '@jobforge/shared'
import { emitToolAudit, emitDenialAudit, emitRateLimitAudit } from '../audit/emitter'
import { validatePolicyToken } from '../auth/resolver'

// ============================================================================
// Tool Registry
// ============================================================================

class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.tools.set(tool.name, tool as ToolDefinition)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  checkAvailability(name: string): ToolAvailability {
    const tool = this.tools.get(name)
    if (!tool) {
      return { available: false, reason: 'Tool not found' }
    }

    if (!MCP_ENABLED) {
      return { available: false, reason: 'MCP is disabled', requiresFlag: 'MCP_ENABLED' }
    }

    if (tool.isWrite && !MCP_WRITE_ENABLED) {
      return {
        available: false,
        reason: 'Write operations are disabled',
        requiresFlag: 'MCP_WRITE_ENABLED',
        isWrite: true,
      }
    }

    if (name.startsWith('readylayer.pr.') && !MCP_PR_ENABLED) {
      return {
        available: false,
        reason: 'PR operations are disabled',
        requiresFlag: 'MCP_PR_ENABLED',
        isWrite: true,
      }
    }

    if (
      name.startsWith('readylayer.') &&
      !name.startsWith('readylayer.pr.') &&
      !MCP_READYLAYER_ENABLED
    ) {
      return {
        available: false,
        reason: 'ReadyLayer tools are disabled',
        requiresFlag: 'MCP_READYLAYER_ENABLED',
      }
    }

    return { available: true, isWrite: tool.isWrite }
  }
}

// Singleton registry
export const toolRegistry = new ToolRegistry()

// ============================================================================
// Tool Execution
// ============================================================================

/**
 * Execute a tool with full security enforcement
 */
export async function executeTool(
  toolName: string,
  args: unknown,
  context: ToolContext
): Promise<ToolResult> {
  const startTime = Date.now()
  const tool = toolRegistry.get(toolName)

  // Check if tool exists
  if (!tool) {
    const result: ToolResult = {
      success: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${toolName}`,
      },
    }
    emitToolAudit(context, result, args, Date.now() - startTime)
    return result
  }

  // Check availability (feature flags)
  const availability = toolRegistry.checkAvailability(toolName)
  if (!availability.available) {
    const result: ToolResult = {
      success: false,
      error: {
        code: availability.isWrite ? 'WRITE_DISABLED' : 'TOOL_UNAVAILABLE',
        message: availability.reason || 'Tool unavailable',
      },
    }
    emitDenialAudit(
      toolName,
      context.actor,
      context.traceId,
      availability.reason || 'Tool unavailable'
    )
    return result
  }

  // Check write operations require policy token
  if (tool.requiresPolicyToken) {
    const policyToken = (args as Record<string, unknown>)?.policyToken as string | undefined
    if (!policyToken) {
      const result: ToolResult = {
        success: false,
        error: {
          code: 'POLICY_TOKEN_REQUIRED',
          message: 'This operation requires a policy token',
        },
      }
      emitDenialAudit(toolName, context.actor, context.traceId, 'Missing policy token')
      return result
    }

    const validation = validatePolicyToken(policyToken)
    if (!validation.valid) {
      const result: ToolResult = {
        success: false,
        error: {
          code: 'POLICY_TOKEN_INVALID',
          message: validation.error?.message || 'Invalid policy token',
        },
      }
      emitDenialAudit(toolName, context.actor, context.traceId, 'Invalid policy token')
      return result
    }

    // Check if token allows this tool
    if (validation.payload?.allowed_tools && !validation.payload.allowed_tools.includes(toolName)) {
      const result: ToolResult = {
        success: false,
        error: {
          code: 'POLICY_TOKEN_INVALID',
          message: 'Policy token does not authorize this tool',
        },
      }
      emitDenialAudit(
        toolName,
        context.actor,
        context.traceId,
        'Tool not authorized by policy token'
      )
      return result
    }
  }

  // Check scopes
  const scopeCheck = checkScopes({
    requiredScopes: tool.requiredScopes,
    grantedScopes: context.actor.scopes,
    resource: toolName,
    action: tool.isWrite ? 'write' : 'read',
  })

  if (!scopeCheck.allowed) {
    const result: ToolResult = {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: scopeCheck.reason || 'Missing required scopes',
      },
    }
    emitDenialAudit(
      toolName,
      context.actor,
      context.traceId,
      scopeCheck.reason || 'Missing scopes',
      tool.requiredScopes
    )
    return result
  }

  // Check rate limit
  const rateLimit = tool.rateLimit || {
    max: MCP_RATE_LIMIT_MAX,
    windowMs: MCP_RATE_LIMIT_WINDOW_MS,
  }
  const rateLimitCheck = checkRateLimit(context.actor.tenantId, context.actor.actorId, {
    maxRequests: rateLimit.max,
    windowMs: rateLimit.windowMs,
    perActor: true,
  })

  if (!rateLimitCheck.allowed) {
    const result: ToolResult = {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: `Rate limit exceeded. Try again after ${new Date(rateLimitCheck.resetAt).toISOString()}`,
      },
    }
    emitRateLimitAudit(toolName, context.actor, context.traceId)
    return result
  }

  // Validate input
  let validatedInput: unknown
  try {
    validatedInput = tool.inputSchema.parse(args)
  } catch (error) {
    if (error instanceof z.ZodError) {
      const result: ToolResult = {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: `Validation failed: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          details: { issues: error.issues },
        },
      }
      emitToolAudit(context, result, args, Date.now() - startTime)
      return result
    }
    throw error
  }

  // Execute tool
  try {
    const result = await tool.handler(validatedInput, context)
    const durationMs = Date.now() - startTime

    // Add metadata
    result.meta = {
      traceId: context.traceId,
      durationMs,
    }

    emitToolAudit(context, result, validatedInput, durationMs)
    return result
  } catch (error) {
    const durationMs = Date.now() - startTime
    const mcpError =
      error instanceof McpServerError
        ? error
        : new McpServerError(
            'INTERNAL_ERROR',
            error instanceof Error ? error.message : 'Unknown error',
            {},
            error
          )

    const result: ToolResult = {
      success: false,
      error: {
        code: mcpError.code,
        message: mcpError.message,
        details: mcpError.details,
      },
      meta: {
        traceId: context.traceId,
        durationMs,
      },
    }

    emitToolAudit(context, result, validatedInput, durationMs)
    return result
  }
}

// ============================================================================
// Helper for registering tools
// ============================================================================

/**
 * Register a tool with the registry
 */
export function registerTool<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
  toolRegistry.register(tool)
}

/**
 * List all registered tools
 */
export function listTools(): ToolDefinition[] {
  return toolRegistry.list()
}

/**
 * Check tool availability
 */
export function checkToolAvailability(toolName: string): ToolAvailability {
  return toolRegistry.checkAvailability(toolName)
}
