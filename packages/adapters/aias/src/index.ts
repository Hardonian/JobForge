/**
 * @jobforge/adapter-aias
 * JobForge adapter for AIAS (AI Agent System)
 */

import { z } from "zod";

/**
 * Job Type: aias.agent.execute
 * Execute AI agent workflow
 */
export const AiasAgentExecutePayloadSchema = z.object({
  agent_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  input_data: z.record(z.unknown()),
  model: z.string().default("gpt-4"),
  max_tokens: z.number().int().positive().default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  tools: z.array(z.string()).optional(),
});

export type AiasAgentExecutePayload = z.infer<typeof AiasAgentExecutePayloadSchema>;

export interface AiasAgentExecuteResult {
  agent_id: string;
  execution_id: string;
  output: Record<string, unknown>;
  tokens_used: number;
  steps_executed: number;
  artifacts: string[];
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
});

export type AiasKnowledgeIndexPayload = z.infer<typeof AiasKnowledgeIndexPayloadSchema>;

export interface AiasKnowledgeIndexResult {
  indexed_documents: number;
  total_chunks: number;
  index_name: string;
}

export const AIAS_INTEGRATION_EXAMPLE = `
// Execute AI agent from API route
import { JobForgeClient } from '@jobforge/sdk-ts';

export async function POST(request: Request) {
  const { agent_id, input_data } = await request.json();

  const jobforge = new JobForgeClient({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });

  const job = await jobforge.enqueueJob({
    tenant_id: getTenantId(),
    type: 'aias.agent.execute',
    payload: {
      agent_id,
      tenant_id: getTenantId(),
      input_data,
    },
  });

  return Response.json({ job_id: job.id });
}
`;
