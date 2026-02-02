/**
 * @jobforge/adapter-keys
 * JobForge adapter for KEYS (API key management platform)
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
 * Job Type: keys.usage.aggregate
 * Aggregate API key usage metrics
 */
export const KeysUsageAggregatePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_ids: z.array(z.string().uuid()).optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  granularity: z.enum(['hour', 'day', 'week']).default('day'),
})

export type KeysUsageAggregatePayload = z.infer<typeof KeysUsageAggregatePayloadSchema>

export interface KeysUsageAggregateResult {
  total_requests: number
  total_cost: number
  keys_breakdown: Record<string, { requests: number; cost: number }>
  period: { start: string; end: string }
}

/**
 * Job Type: keys.quota.check
 * Check and enforce API key quotas
 */
export const KeysQuotaCheckPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_id: z.string().uuid(),
  enforce: z.boolean().default(false),
  notify_on_threshold: z.number().min(0).max(1).default(0.8),
})

export type KeysQuotaCheckPayload = z.infer<typeof KeysQuotaCheckPayloadSchema>

export interface KeysQuotaCheckResult {
  key_id: string
  usage_percentage: number
  threshold_exceeded: boolean
  actions_taken: string[]
}

/**
 * Job Type: keys.rotation.schedule
 * Schedule automatic key rotation
 */
export const KeysRotationSchedulePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_id: z.string().uuid(),
  rotation_date: z.string().datetime(),
  notify_before_days: z.number().int().positive().default(7),
  auto_rotate: z.boolean().default(false),
})

export type KeysRotationSchedulePayload = z.infer<typeof KeysRotationSchedulePayloadSchema>

export interface KeysRotationScheduleResult {
  key_id: string
  rotation_scheduled: boolean
  new_key_id?: string
  notifications_sent: number
}

// ============================================================================
// Execution Plane Integration
// ============================================================================

/**
 * Keys JobForge Adapter
 *
 * Provides:
 * - submitEvent(envelope) - Submit events to execution plane
 * - requestJob(job_type,...) - Request autopilot jobs
 * - getRunManifest/runStatus - Check job status
 * - Trace ID propagation across HTTP/jobs/tools
 */
export class KeysAdapter extends JobForgeAdapter {
  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({
      app: 'keys',
      tenantId,
      projectId,
      client,
    })
  }

  // ============================================================================
  // Event Submission
  // ============================================================================

  /**
   * Submit an API key-related event
   */
  async submitKeyEvent(
    eventType: 'key.created' | 'key.rotated' | 'key.revoked' | 'key.quota_exceeded',
    payload: { key_id: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `keys.${eventType}`,
      payload,
      traceId,
      module: 'core',
      subjectType: 'api_key',
      subjectId: payload.key_id,
    })
  }

  /**
   * Submit a usage/usage anomaly event
   */
  async submitUsageEvent(
    eventType: 'usage.anomaly' | 'usage.threshold_exceeded',
    payload: { key_id: string; threshold: number; current_usage: number; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `keys.${eventType}`,
      payload,
      traceId,
      module: 'core',
      subjectType: 'api_key',
      subjectId: payload.key_id,
    })
  }

  /**
   * Submit a finops-related event
   */
  async submitFinOpsEvent(
    eventType: 'cost.anomaly' | 'cost.projection',
    payload: Record<string, unknown>,
    traceId?: string
  ) {
    return this.submitEvent({
      eventType,
      payload,
      traceId,
      module: 'finops',
    })
  }

  // ============================================================================
  // Job Requests
  // ============================================================================

  /**
   * Request usage aggregation job
   */
  async requestUsageAggregation(
    startDate: string,
    endDate: string,
    options?: { keyIds?: string[]; granularity?: 'hour' | 'day' | 'week'; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'keys.usage.aggregate',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        key_ids: options?.keyIds,
        start_date: startDate,
        end_date: endDate,
        granularity: options?.granularity || 'day',
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request quota check job
   */
  async requestQuotaCheck(
    keyId: string,
    options?: { enforce?: boolean; notifyOnThreshold?: number; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'keys.quota.check',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        key_id: keyId,
        enforce: options?.enforce ?? false,
        notify_on_threshold: options?.notifyOnThreshold || 0.8,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request key rotation scheduling
   */
  async requestKeyRotation(
    keyId: string,
    rotationDate: string,
    options?: { notifyBeforeDays?: number; autoRotate?: boolean; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'keys.rotation.schedule',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        key_id: keyId,
        rotation_date: rotationDate,
        notify_before_days: options?.notifyBeforeDays || 7,
        auto_rotate: options?.autoRotate ?? false,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request autopilot finops scan (cost anomaly detection)
   */
  async requestFinOpsScan(timeRange: string = '1d', traceId?: string) {
    return this.requestJob({
      templateKey: 'autopilot.finops.anomaly_scan',
      inputs: {
        time_range: timeRange,
        tenant_id: this.getConfig().tenantId,
      },
      traceId,
    })
  }
}

/**
 * Create a Keys adapter instance
 *
 * @param tenantId - Optional tenant ID (uses JOBFORGE_TENANT_MAPPING if not provided)
 * @param projectId - Optional project ID (uses JOBFORGE_PROJECT_MAPPING if not provided)
 * @param client - Optional JobForgeClient instance
 *
 * Environment:
 * - JOBFORGE_INTEGRATION_ENABLED=0 - Master enablement flag (default: disabled)
 * - JOBFORGE_KEYS_ENABLED=1 - App-specific override
 * - JOBFORGE_TENANT_MAPPING=keys:uuid1,settler:uuid2
 * - JOBFORGE_PROJECT_MAPPING=keys:proj1,settler:proj2
 * - SUPABASE_URL - Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 */
export function createKeysAdapter(
  tenantId?: string,
  projectId?: string,
  client?: JobForgeClient
): KeysAdapter {
  return new KeysAdapter(tenantId, projectId, client)
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
 * Create trace context for a Keys operation
 */
export function createKeysTraceContext(tenantId: string, actorId?: string): TraceContext {
  return {
    trace_id: crypto.randomUUID(),
    tenant_id: tenantId,
    source_app: 'keys',
    actor_id: actorId,
    started_at: new Date().toISOString(),
  }
}

// ============================================================================
// Integration Examples
// ============================================================================

export const KEYS_INTEGRATION_EXAMPLE = `
// Schedule key rotation with execution plane integration
'use server';

import { createKeysAdapter, extractTraceFromHeaders } from '@jobforge/adapter-keys';

const adapter = createKeysAdapter();

export async function scheduleKeyRotation(keyId: string, rotationDate: Date, headers: Headers) {
  // Extract trace from incoming request
  const traceId = extractTraceFromHeaders(headers);
  
  // Submit event (requires JOBFORGE_INTEGRATION_ENABLED=1)
  await adapter.submitKeyEvent('key.rotated', { key_id: keyId }, traceId);
  
  // Request rotation job (dry-run by default until enabled)
  const result = await adapter.requestKeyRotation(
    keyId, 
    rotationDate.toISOString(),
    { autoRotate: true, traceId }
  );
  
  return { 
    job_id: result?.job?.id, 
    trace_id: result?.trace_id || traceId 
  };
}
`
