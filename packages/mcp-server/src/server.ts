/**
 * MCP Server Entry Point
 * Stdio-based MCP server for JobForge
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'crypto'

import { MCP_ENABLED, verifyMcpSafety, getMcpFeatureFlagSummary } from './feature-flags'
import { resolveAuth } from './auth/resolver'
import { registerJobTools } from './tools/jobs'
import { registerConnectorTools } from './tools/connectors'
import { registerArtifactTools } from './tools/artifacts'
import { registerReadyLayerTools } from './tools/readylayer'
import { executeTool, listTools, checkToolAvailability } from './tools/registry'
import type { ToolContext } from './types'

// ============================================================================
// Safety Check
// ============================================================================

try {
  verifyMcpSafety()
} catch (error) {
  console.error('MCP Safety Check Failed:', error)
  process.exit(1)
}

// ============================================================================
// Register All Tools
// ============================================================================

registerJobTools()
registerConnectorTools()
registerArtifactTools()
registerReadyLayerTools()

// ============================================================================
// Create MCP Server
// ============================================================================

const server = new Server(
  {
    name: 'jobforge-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
)

// ============================================================================
// Handlers
// ============================================================================

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (!MCP_ENABLED) {
    return {
      tools: [],
    }
  }

  const tools = listTools()
  return {
    tools: tools.map((tool) => {
      const availability = checkToolAvailability(tool.name)
      return {
        name: tool.name,
        description:
          tool.description + (availability.available ? '' : ` [DISABLED: ${availability.reason}]`),
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
      }
    }),
  }
})

// Execute a tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  // Generate trace ID for this request
  const traceId = randomUUID()

  // Resolve authentication (in stdio mode, we use dev mode or env-based auth)
  // For stdio, we typically run in MCP_DEV_MODE=1 locally
  const authHeader = process.env.MCP_AUTH_HEADER
  const tenantId = process.env.MCP_DEFAULT_TENANT_ID

  const auth = await resolveAuth(authHeader, tenantId)

  if (!auth.success) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: (auth as { error: { code: string; message: string } }).error,
            traceId,
          }),
        },
      ],
      isError: true,
    }
  }

  // Create tool context
  const context: ToolContext = {
    actor: auth.actor,
    traceId,
    toolName: name,
    startedAt: new Date(),
  }

  // Execute the tool
  const result = await executeTool(name, args, context)

  // Format response
  const response = {
    success: result.success,
    data: result.data,
    error: result.error,
    meta: result.meta,
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(response, null, 2),
      },
    ],
    isError: !result.success,
  }
})

// ============================================================================
// Start Server
// ============================================================================

async function main(): Promise<void> {
  if (!MCP_ENABLED) {
    console.error('MCP server is disabled. Set MCP_ENABLED=1 to enable.')
    console.error('Current feature flags:', JSON.stringify(getMcpFeatureFlagSummary(), null, 2))
    process.exit(0)
  }

  const transport = new StdioServerTransport()

  // Log startup (to stderr so it doesn't interfere with stdio protocol)
  console.error('JobForge MCP Server starting...')
  console.error('Feature flags:', JSON.stringify(getMcpFeatureFlagSummary(), null, 2))
  console.error(
    'Registered tools:',
    listTools()
      .map((t) => t.name)
      .join(', ')
  )

  await server.connect(transport)

  console.error('JobForge MCP Server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
