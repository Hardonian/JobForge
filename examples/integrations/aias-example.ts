/**
 * AIAS Integration Example
 *
 * Demonstrates how to route AI agent tasks through JobForge.
 *
 * AIAS (AI Agent System) is an autonomous agent platform that needs:
 * - Agent workflow execution
 * - Knowledge base indexing
 * - Autonomous decision routing
 */

import { JobForgeClient } from '@jobforge/sdk-ts'

// ============================================================================
// Configuration
// ============================================================================

const JOBFORGE_ENABLED = process.env.JOBFORGE_INTEGRATION_ENABLED === '1'
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================================================
// AIAS Adapter
// ============================================================================

interface AgentExecutionPayload {
  agent_id: string
  tenant_id: string
  workflow_id: string
  inputs: Record<string, unknown>
  max_steps: number
  context_window?: number
}

interface KnowledgeIndexingPayload {
  tenant_id: string
  document_ids: string[]
  index_type: 'vector' | 'keyword' | 'hybrid'
  priority: 'high' | 'normal' | 'low'
}

export class AIASJobForgeAdapter {
  private client: JobForgeClient
  private tenantId: string

  constructor(tenantId: string) {
    this.tenantId = tenantId
    this.client = new JobForgeClient({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
    })
  }

  /**
   * Queue AI agent workflow execution
   */
  async executeAgent(payload: AgentExecutionPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[AIAS] JobForge disabled, executing synchronously')
      return this.executeSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'aias.agent.execute',
      payload: {
        agent_id: payload.agent_id,
        tenant_id: payload.tenant_id,
        workflow_id: payload.workflow_id,
        inputs: payload.inputs,
        max_steps: payload.max_steps,
        context_window: payload.context_window || 4096,
      },
      idempotency_key: `aias-execute-${payload.agent_id}-${Date.now()}`,
    })

    console.log(`[AIAS] Queued agent execution: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue knowledge base indexing
   */
  async indexDocuments(payload: KnowledgeIndexingPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[AIAS] JobForge disabled, indexing synchronously')
      return this.indexSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'aias.knowledge.index',
      payload: {
        tenant_id: payload.tenant_id,
        document_ids: payload.document_ids,
        index_type: payload.index_type,
        priority: payload.priority,
      },
      idempotency_key: `aias-index-${payload.document_ids.join('-')}`,
    })

    console.log(`[AIAS] Queued knowledge indexing: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue autonomous task routing
   */
  async routeAutonomousTask(taskDescription: string, context: Record<string, unknown>) {
    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'autopilot.support.triage',
      payload: {
        tenant_id: this.tenantId,
        task_description: taskDescription,
        context,
        routing_strategy: 'autonomous',
      },
      idempotency_key: `aias-route-${Date.now()}`,
    })

    console.log(`[AIAS] Queued autonomous routing: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Generate content via autopilot
   */
  async generateContent(
    contentType: 'marketing' | 'documentation' | 'email',
    topic: string,
    tone: 'professional' | 'casual' | 'technical'
  ) {
    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'autopilot.growth.content_draft',
      payload: {
        tenant_id: this.tenantId,
        content_type: contentType,
        topic,
        tone,
        max_length: 1000,
      },
      idempotency_key: `aias-content-${contentType}-${topic}-${Date.now()}`,
    })

    console.log(`[AIAS] Queued content generation: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  // Fallback synchronous processing
  private async executeSync(payload: AgentExecutionPayload) {
    console.log(`[AIAS] Executing agent ${payload.agent_id} synchronously`)
    return {
      job_id: 'sync-' + Date.now(),
      status: 'completed',
      result: { steps_executed: 0, final_output: 'Mock execution' },
    }
  }

  private async indexSync(payload: KnowledgeIndexingPayload) {
    console.log(`[AIAS] Indexing ${payload.document_ids.length} documents synchronously`)
    return { job_id: 'sync-' + Date.now(), status: 'completed' }
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function example() {
  const adapter = new AIASJobForgeAdapter('tenant-ai-789')

  // Example 1: Execute customer support agent
  const agentExecution = await adapter.executeAgent({
    agent_id: 'support-agent-v2',
    tenant_id: 'tenant-ai-789',
    workflow_id: 'ticket-resolution',
    inputs: {
      ticket_id: 'TKT-12345',
      customer_query: 'How do I reset my password?',
      priority: 'high',
    },
    max_steps: 10,
    context_window: 8192,
  })

  console.log('Agent execution queued:', agentExecution)

  // Example 2: Index documents for RAG
  const indexing = await adapter.indexDocuments({
    tenant_id: 'tenant-ai-789',
    document_ids: ['doc-001', 'doc-002', 'doc-003'],
    index_type: 'hybrid',
    priority: 'high',
  })

  console.log('Knowledge indexing queued:', indexing)

  // Example 3: Route complex task autonomously
  const routing = await adapter.routeAutonomousTask(
    'Analyze Q4 sales data and generate recommendations',
    {
      data_source: 'sales_db',
      time_range: 'Q4-2024',
      output_format: 'executive_summary',
    }
  )

  console.log('Autonomous routing queued:', routing)

  // Example 4: Generate marketing content
  const content = await adapter.generateContent(
    'marketing',
    'New feature launch: AI-powered analytics',
    'professional'
  )

  console.log('Content generation queued:', content)
}

// Run if executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example as runAIASExample }
