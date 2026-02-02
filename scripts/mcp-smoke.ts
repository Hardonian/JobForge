/**
 * MCP Smoke Test Script
 * Tests the MCP server functionality locally
 *
 * Usage:
 *   tsx scripts/mcp-smoke.ts
 *
 * Environment:
 *   MCP_ENABLED=1 MCP_DEV_MODE=1 MCP_WRITE_ENABLED=1 MCP_READYLAYER_ENABLED=1
 */

import { spawn } from 'child_process'
import { resolve } from 'path'

const MCP_SERVER_PATH = resolve(__dirname, '../packages/mcp-server/dist/server.js')

interface MCPRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: '2.0'
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
  }
}

function createRequest(id: number, method: string, params: Record<string, unknown>): MCPRequest {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params,
  }
}

async function sendRequest(
  process: ReturnType<typeof spawn>,
  request: MCPRequest
): Promise<MCPResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Request timeout'))
    }, 10000)

    const handler = (data: Buffer) => {
      try {
        const lines = data.toString().trim().split('\n')
        for (const line of lines) {
          if (line.trim()) {
            const response = JSON.parse(line) as MCPResponse
            if (response.id === request.id) {
              clearTimeout(timeout)
              process.stdout.off('data', handler)
              resolve(response)
              return
            }
          }
        }
      } catch {
        // Continue waiting for valid JSON
      }
    }

    process.stdout.on('data', handler)
    process.stdin.write(JSON.stringify(request) + '\n')
  })
}

async function runSmokeTest(): Promise<void> {
  console.log('=== MCP Smoke Test ===\n')

  // Check if server is built
  const fs = await import('fs')
  if (!fs.existsSync(MCP_SERVER_PATH)) {
    console.error('MCP server not built. Run: pnpm --filter @jobforge/mcp-server build')
    process.exit(1)
  }

  // Start MCP server
  console.log('Starting MCP server...')
  const mcpProcess = spawn('node', [MCP_SERVER_PATH], {
    env: {
      ...process.env,
      MCP_ENABLED: '1',
      MCP_DEV_MODE: '1',
      MCP_WRITE_ENABLED: '1',
      MCP_READYLAYER_ENABLED: '1',
      MCP_DEFAULT_TENANT_ID: '00000000-0000-0000-0000-000000000000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  let requestId = 1

  // Wait for server to start
  await new Promise((resolve) => setTimeout(resolve, 1000))

  try {
    // Test 1: List tools
    console.log('\n[TEST 1] Listing tools...')
    const listRequest = createRequest(requestId++, 'tools/list', {})
    const listResponse = await sendRequest(mcpProcess, listRequest)

    if (listResponse.error) {
      console.error('  FAILED:', listResponse.error.message)
    } else {
      const tools = (listResponse.result as { tools: Array<{ name: string }> })?.tools || []
      console.log(`  SUCCESS: Found ${tools.length} tools`)
      console.log('  Tools:', tools.map((t) => t.name).join(', '))
    }

    // Test 2: Call jobforge.jobs.status (read operation)
    console.log('\n[TEST 2] Calling jobforge.jobs.status (read)...')
    const statusRequest = createRequest(requestId++, 'tools/call', {
      name: 'jobforge.jobs.status',
      arguments: {
        runId: '00000000-0000-0000-0000-000000000001',
        tenantId: '00000000-0000-0000-0000-000000000000',
      },
    })
    const statusResponse = await sendRequest(mcpProcess, statusRequest)
    console.log(
      '  Response:',
      JSON.stringify(statusResponse.result || statusResponse.error, null, 2)
    )

    // Test 3: Call jobforge.connectors.list
    console.log('\n[TEST 3] Calling jobforge.connectors.list...')
    const connectorsRequest = createRequest(requestId++, 'tools/call', {
      name: 'jobforge.connectors.list',
      arguments: {
        tenantId: '00000000-0000-0000-0000-000000000000',
      },
    })
    const connectorsResponse = await sendRequest(mcpProcess, connectorsRequest)
    console.log(
      '  Response:',
      JSON.stringify(connectorsResponse.result || connectorsResponse.error, null, 2)
    )

    // Test 4: Call readylayer.quality.verify
    console.log('\n[TEST 4] Calling readylayer.quality.verify...')
    const verifyRequest = createRequest(requestId++, 'tools/call', {
      name: 'readylayer.quality.verify',
      arguments: {
        tenantId: '00000000-0000-0000-0000-000000000000',
        repoPath: process.cwd(),
        pack: 'fast',
      },
    })
    const verifyResponse = await sendRequest(mcpProcess, verifyRequest)
    console.log(
      '  Response:',
      JSON.stringify(verifyResponse.result || verifyResponse.error, null, 2)
    )

    console.log('\n=== Smoke Test Complete ===')
  } catch (error) {
    console.error('\nSmoke test failed:', error)
  } finally {
    mcpProcess.kill()
  }
}

runSmokeTest().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
