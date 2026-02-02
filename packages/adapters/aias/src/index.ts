/**
 * @jobforge/adapter-aias
 * JobForge adapter for AIAS (AI Agent System)
 *
 * INTEGRATION POINT: This adapter now extends JobForgeAdapter for execution plane integration.
 * Feature flag: JOBFORGE_INTEGRATION_ENABLED=0 (disabled by default)
 */

import { z } from 'zod'
import { JobForgeAdapter } from '@jobforge/integration'
import type { JobForgeClient } from '@jobforge/sdk-ts'
import type { TraceContext } from '@jobforge/integration'

// ============================================================================
// Job Payload Schemas (existing)
// ============================================================================

/**
 * Job Type: aias.agent.execute
 * Execute AI agent workflow
 */
export const AiasAgentExecutePayloadSchema = z.object({
  agent_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  input_data: z.record(z.unknown()),
  model: z.string().default('gpt-4'),
  max_tokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  tools: z.array(z.string()).optional(),
})

export type AiasAgentExecutePayload = z.infer<typeof AiasAgentExecutePayloadSchema>

export interface AiasAgentExecuteResult {
  agent_id: string
  execution_id: string
  output: Record<string, unknown>
  tokens_used: number
  steps_executed: number
  artifacts: string[]
}

/**
 * Job Type: aias.knowledge.index
 * Index documents for RAG
 */
export const AiasKnowledgeIndexPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  document_ids: z.array(z.string().uuid()),
  index_name: z.string(),
  chunk_size: z.number().int().positive().default(512),
  overlap: z.number().int().nonnegative().default(50),
})

export type AiasKnowledgeIndexPayload = z.infer<typeof AiasKnowledgeIndexPayloadSchema>

export interface AiasKnowledgeIndexResult {
  indexed_documents: number
  total_chunks: number
  index_name: string
}

// ============================================================================
// Execution Plane Integration
// ============================================================================

/**
 * AIAS JobForge Adapter
 *
 * Provides:
 * - submitEvent(envelope) - Submit events to execution plane
 * - requestJob(job_type,...) - Request autopilot jobs
 * - getRunManifest/runStatus - Check job status
 * - Trace ID propagation across HTTP/jobs/tools
 */
export class AiasAdapter extends JobForgeAdapter {
  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({
      app: 'aias',
      tenantId,
      projectId,
      client,
    })
  }

  // ============================================================================
  // Event Submission
  // ============================================================================

  /**
   * Submit an agent execution event
   */
  async submitAgentEvent(
    eventType: 'agent.started' | 'agent.completed' | 'agent.failed',
    payload: { agent_id: string; execution_id?: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `aias.${eventType}`,
      payload,
      traceId,
      module: 'core',
      subjectType: 'agent',
      subjectId: payload.agent_id,
    })
  }

  /**
   * Submit a knowledge indexing event
   */
  async submitKnowledgeEvent(
    eventType: 'knowledge.indexed' | 'knowledge.updated',
    payload: { document_ids: string[]; index_name: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `aias.${eventType}`,
      payload,
      traceId,
      module: 'core',
    })
  }

  /**
   * Submit a growth-related event (experiments, content)
   */
  async submitGrowthEvent(
    eventType: 'experiment.proposed' | 'content.drafted',
    payload: Record<string, unknown>,
    traceId?: string
  ) {
    return this.submitEvent({
      eventType,
      payload,
      traceId,
      module: 'growth',
    })
  }

  // ============================================================================
  // Job Requests
  // ============================================================================

  /**
   * Request agent execution job
   */
  async requestAgentExecution(
    agentId: string,
    inputData: Record<string, unknown>,
    options?: {
      model?: string
      maxTokens?: number
      temperature?: number
      tools?: string[]
      traceId?: string
    }
  ) {
    return this.requestJob({
      templateKey: 'aias.agent.execute',
      inputs: {
        agent_id: agentId,
        tenant_id: this.getConfig().tenantId,
        input_data: inputData,
        model: options?.model || 'gpt-4',
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 0.7,
        tools: options?.tools,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request knowledge indexing job
   */
  async requestKnowledgeIndexing(
    documentIds: string[],
    indexName: string,
    options?: { chunkSize?: number; overlap?: number; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'aias.knowledge.index',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        document_ids: documentIds,
        index_name: indexName,
        chunk_size: options?.chunkSize || 512,
        overlap: options?.overlap || 50,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request autopilot growth experiment proposal
   */
  async requestGrowthExperiment(target: string, hypothesis: string, traceId?: string) {
    return this.requestJob({
      templateKey: 'autopilot.growth.experiment_propose',
      inputs: {
        target,
        hypothesis,
        tenant_id: this.getConfig().tenantId,
      },
      traceId,
    })
  }

  /**
   * Request autopilot growth content drafting
   */
  async requestContentDraft(topic: string, format: string = 'blog', traceId?: string) {
    return this.requestJob({
      templateKey: 'autopilot.growth.content_draft',
      inputs: {
        topic,
        format,
        tenant_id: this.getConfig().tenantId,
      },
      traceId,
    })
  }
}

/**
 * Create an AIAS adapter instance
 *
 * @param tenantId - Optional tenant ID (uses JOBFORGE_TENANT_MAPPING if not provided)
 * @param projectId - Optional project ID (uses JOBFORGE_PROJECT_MAPPING if not provided)
 * @param client - Optional JobForgeClient instance
 *
 * Environment:
 * - JOBFORGE_INTEGRATION_ENABLED=0 - Master enablement flag (default: disabled)
 * - JOBFORGE_AIAS_ENABLED=1 - App-specific override
 * - JOBFORGE_TENANT_MAPPING=aias:uuid1,settler:uuid2
 * - JOBFORGE_PROJECT_MAPPING=aias:proj1,settler:proj2
 * - SUPABASE_URL - Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 */
export function createAiasAdapter(
  tenantId?: string,
  projectId?: string,
  client?: JobForgeClient
): AiasAdapter {
  return new AiasAdapter(tenantId, projectId, client)
}

// ============================================================================
// Trace Propagation Helpers
// ============================================================================

/**
 * Extract trace ID from incoming request headers
 * Use this in API route handlers
 */
export function extractTraceFromHeaders(headers: Headers): string | undefined {
  const headerValue = headers.get('x-trace-id')
  return headerValue || undefined
}

/**
 * Create trace context for an AIAS operation
 */
export function createAiasTraceContext(tenantId: string, actorId?: string): TraceContext {
  return {
    trace_id: crypto.randomUUID(),
    tenant_id: tenantId,
    source_app: 'aias',
    actor_id: actorId,
    started_at: new Date().toISOString(),
  }
}

// ============================================================================
// Integration Examples
// ============================================================================

export const AIAS_INTEGRATION_EXAMPLE = `
// Execute AI agent with execution plane integration
import { createAiasAdapter, extractTraceFromHeaders } from '@jobforge/adapter-aias';

const adapter = createAiasAdapter();

export async function POST(request: Request) {
  const { agent_id, input_data } = await request.json();
  
  // Extract trace from incoming request
  const traceId = extractTraceFromHeaders(request.headers);
  
  // Submit event (requires JOBFORGE_INTEGRATION_ENABLED=1)
  await adapter.submitAgentEvent('agent.started', { agent_id }, traceId);
  
  // Request agent execution (dry-run by default until enabled)
  const result = await adapter.requestAgentExecution(agent_id, input_data, { traceId });
  
  return Response.json({ 
    job_id: result?.job?.id, 
    trace_id: result?.trace_id || traceId 
  });
}
`
