/**
 * @jobforge/adapter-settler
 * JobForge adapter for Settler (contract management platform)
 *
 * INTEGRATION POINT: This adapter now extends JobForgeAdapter for execution plane integration.
 * Feature flag: JOBFORGE_INTEGRATION_ENABLED=0 (disabled by default)
 */

import { z } from 'zod'
import { JobForgeAdapter, createJobForgeAdapter } from '@jobforge/integration'
import type { JobForgeClient } from '@jobforge/sdk-ts'
import type { TraceContext } from '@jobforge/integration'

// ============================================================================
// Job Payload Schemas (existing)
// ============================================================================

/**
 * Job Type: settler.contract.process
 * Process uploaded contract documents
 */
export const SettlerContractProcessPayloadSchema = z.object({
  contract_id: z.string().uuid(),
  document_url: z.string().url(),
  tenant_id: z.string().uuid(),
  extract_fields: z
    .array(z.string())
    .default(['parties', 'effective_date', 'expiration_date', 'payment_terms']),
  notify_on_complete: z.boolean().default(true),
})

export type SettlerContractProcessPayload = z.infer<typeof SettlerContractProcessPayloadSchema>

export interface SettlerContractProcessResult {
  contract_id: string
  extracted_data: Record<string, unknown>
  confidence_scores: Record<string, number>
  review_required: boolean
}

/**
 * Job Type: settler.notification.send
 * Send contract-related notifications
 */
export const SettlerNotificationSendPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  notification_type: z.enum([
    'contract_expiring',
    'signature_required',
    'contract_executed',
    'review_requested',
  ]),
  contract_id: z.string().uuid(),
  metadata: z.record(z.unknown()).optional(),
  channels: z.array(z.enum(['email', 'sms', 'in_app'])).default(['email', 'in_app']),
})

export type SettlerNotificationSendPayload = z.infer<typeof SettlerNotificationSendPayloadSchema>

export interface SettlerNotificationSendResult {
  notification_id: string
  channels_sent: string[]
  failed_channels: string[]
}

/**
 * Job Type: settler.report.monthly
 * Generate monthly contract analytics report
 */
export const SettlerReportMonthlyPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  include_charts: z.boolean().default(true),
  delivery_emails: z.array(z.string().email()).optional(),
})

export type SettlerReportMonthlyPayload = z.infer<typeof SettlerReportMonthlyPayloadSchema>

export interface SettlerReportMonthlyResult {
  report_id: string
  total_contracts: number
  new_contracts: number
  expiring_contracts: number
  total_value: number
  artifact_ref: string
}

// ============================================================================
// Execution Plane Integration
// ============================================================================

/**
 * Settler JobForge Adapter
 *
 * Provides:
 * - submitEvent(envelope) - Submit events to execution plane
 * - requestJob(job_type,...) - Request autopilot jobs
 * - getRunManifest/runStatus - Check job status
 * - Trace ID propagation across HTTP/jobs/tools
 *
 * Usage:
 * ```typescript
 * const adapter = createSettlerAdapter(tenantId, projectId)
 *
 * // Submit event
 * await adapter.submitContractEvent('contract.created', { contract_id: '...' })
 *
 * // Request job
 * const result = await adapter.requestContractProcessing(contractId, documentUrl)
 * ```
 */
export class SettlerAdapter extends JobForgeAdapter {
  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({
      app: 'settler',
      tenantId,
      projectId,
      client,
    })
  }

  // ============================================================================
  // Event Submission
  // ============================================================================

  /**
   * Submit a contract-related event
   */
  async submitContractEvent(
    eventType: 'contract.created' | 'contract.updated' | 'contract.executed' | 'contract.expiring',
    payload: { contract_id: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `settler.${eventType}`,
      payload,
      traceId,
      module: 'core',
      subjectType: 'contract',
      subjectId: payload.contract_id,
    })
  }

  /**
   * Submit an ops-related event (infrastructure, alerts)
   */
  async submitOpsEvent(
    eventType: 'infrastructure.alert' | 'performance.degradation',
    payload: Record<string, unknown>,
    traceId?: string
  ) {
    return this.submitEvent({
      eventType,
      payload,
      traceId,
      module: 'ops',
    })
  }

  // ============================================================================
  // Job Requests
  // ============================================================================

  /**
   * Request contract processing job
   */
  async requestContractProcessing(
    contractId: string,
    documentUrl: string,
    options?: { extractFields?: string[]; notifyOnComplete?: boolean; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'settler.contract.process',
      inputs: {
        contract_id: contractId,
        document_url: documentUrl,
        tenant_id: this.getConfig().tenantId,
        extract_fields: options?.extractFields || ['parties', 'effective_date', 'expiration_date'],
        notify_on_complete: options?.notifyOnComplete ?? true,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request autopilot ops scan (infrastructure check)
   */
  async requestOpsScan(target: string = 'production', traceId?: string) {
    return this.requestJob({
      templateKey: 'autopilot.ops.scan',
      inputs: {
        target,
        scan_type: 'infrastructure',
        tenant_id: this.getConfig().tenantId,
      },
      traceId,
    })
  }

  /**
   * Request monthly report generation
   */
  async requestMonthlyReport(year: number, month: number, traceId?: string) {
    return this.requestJob({
      templateKey: 'settler.report.monthly',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        year,
        month,
        include_charts: true,
      },
      traceId,
    })
  }
}

/**
 * Create a Settler adapter instance
 *
 * @param tenantId - Optional tenant ID (uses JOBFORGE_TENANT_MAPPING if not provided)
 * @param projectId - Optional project ID (uses JOBFORGE_PROJECT_MAPPING if not provided)
 * @param client - Optional JobForgeClient instance
 *
 * Environment:
 * - JOBFORGE_INTEGRATION_ENABLED=0 - Master enablement flag (default: disabled)
 * - JOBFORGE_SETTLER_ENABLED=1 - App-specific override
 * - JOBFORGE_TENANT_MAPPING=settler:uuid1,keys:uuid2
 * - JOBFORGE_PROJECT_MAPPING=settler:proj1,keys:proj2
 * - SUPABASE_URL - Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 */
export function createSettlerAdapter(
  tenantId?: string,
  projectId?: string,
  client?: JobForgeClient
): SettlerAdapter {
  return new SettlerAdapter(tenantId, projectId, client)
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
 * Create trace context for a Settler operation
 */
export function createSettlerTraceContext(tenantId: string, actorId?: string): TraceContext {
  return {
    trace_id: crypto.randomUUID(),
    tenant_id: tenantId,
    source_app: 'settler',
    actor_id: actorId,
    started_at: new Date().toISOString(),
  }
}

// ============================================================================
// Legacy Integration Examples (kept for reference)
// ============================================================================

export const SETTLER_INTEGRATION_EXAMPLES = {
  serverAction: `
// app/actions/contract.ts
'use server';

import { createSettlerAdapter } from '@jobforge/adapter-settler';

const adapter = createSettlerAdapter();

export async function processContract(contractId: string, documentUrl: string) {
  // Submit event (requires JOBFORGE_INTEGRATION_ENABLED=1)
  await adapter.submitContractEvent('contract.created', { contract_id: contractId });
  
  // Request processing job (dry-run by default until enabled)
  const result = await adapter.requestContractProcessing(contractId, documentUrl);
  
  return { job_id: result?.job?.id, trace_id: result?.trace_id };
}
  `,

  apiRoute: `
// app/api/contracts/[id]/process/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSettlerAdapter, extractTraceFromHeaders } from '@jobforge/adapter-settler';

const adapter = createSettlerAdapter();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  // Extract trace from incoming request
  const traceId = extractTraceFromHeaders(request.headers);
  
  const { document_url } = await request.json();

  // Request with trace propagation
  const result = await adapter.requestContractProcessing(params.id, document_url, { traceId });

  return NextResponse.json({ 
    job_id: result?.job?.id, 
    trace_id: result?.trace_id || traceId 
  });
}
  `,

  workerHandler: `
// services/worker-ts/src/handlers/settler.ts
import { JobContext } from '@jobforge/shared';
import { SettlerContractProcessPayload, SettlerContractProcessPayloadSchema } from '@jobforge/adapter-settler';

export async function settlerContractProcessHandler(
  payload: unknown,
  context: JobContext
): Promise<Record<string, unknown>> {
  // Trace ID is available in context.trace_id
  console.log('Processing with trace:', context.trace_id);
  
  const validated = SettlerContractProcessPayloadSchema.parse(payload);
  
  // Handler implementation...
  
  return {
    contract_id: validated.contract_id,
    trace_id: context.trace_id, // Propagate trace in response
  };
}
  `,
}
