/**
 * @jobforge/adapter-readylayer
 * JobForge adapter for ReadyLayer (content delivery/CDN platform)
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
 * Job Type: readylayer.asset.optimize
 * Optimize and transcode media assets
 */
export const ReadyLayerAssetOptimizePayloadSchema = z.object({
  asset_id: z.string().uuid(),
  source_url: z.string().url(),
  tenant_id: z.string().uuid(),
  formats: z.array(z.enum(['webp', 'avif', 'jpeg', 'png'])).default(['webp']),
  sizes: z.array(z.number()).default([320, 640, 1280, 1920]),
  quality: z.number().min(1).max(100).default(85),
})

export type ReadyLayerAssetOptimizePayload = z.infer<typeof ReadyLayerAssetOptimizePayloadSchema>

export interface ReadyLayerAssetOptimizeResult {
  asset_id: string
  optimized_urls: Record<string, string[]>
  total_size_reduction_bytes: number
  cdn_urls: string[]
}

/**
 * Job Type: readylayer.cache.purge
 * Purge CDN cache for specific paths
 */
export const ReadyLayerCachePurgePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  paths: z.array(z.string()),
  purge_type: z.enum(['soft', 'hard']).default('soft'),
  zones: z.array(z.string()).optional(),
})

export type ReadyLayerCachePurgePayload = z.infer<typeof ReadyLayerCachePurgePayloadSchema>

export interface ReadyLayerCachePurgeResult {
  purged_count: number
  failed_paths: string[]
  estimated_propagation_seconds: number
}

/**
 * Job Type: readylayer.analytics.aggregate
 * Aggregate CDN analytics data
 */
export const ReadyLayerAnalyticsAggregatePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  metrics: z.array(z.enum(['bandwidth', 'requests', 'cache_hit_ratio', 'errors'])),
  group_by: z.enum(['hour', 'day', 'week']).default('day'),
})

export type ReadyLayerAnalyticsAggregatePayload = z.infer<
  typeof ReadyLayerAnalyticsAggregatePayloadSchema
>

export interface ReadyLayerAnalyticsAggregateResult {
  period: { start: string; end: string }
  aggregated_metrics: Record<string, number>
  top_assets: Array<{ url: string; requests: number }>
}

// ============================================================================
// Execution Plane Integration
// ============================================================================

/**
 * ReadyLayer JobForge Adapter
 *
 * Provides:
 * - submitEvent(envelope) - Submit events to execution plane
 * - requestJob(job_type,...) - Request autopilot jobs
 * - getRunManifest/runStatus - Check job status
 * - Trace ID propagation across HTTP/jobs/tools
 */
export class ReadyLayerAdapter extends JobForgeAdapter {
  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({
      app: 'readylayer',
      tenantId,
      projectId,
      client,
    })
  }

  // ============================================================================
  // Event Submission
  // ============================================================================

  /**
   * Submit an asset-related event
   */
  async submitAssetEvent(
    eventType: 'asset.uploaded' | 'asset.optimized' | 'asset.purged',
    payload: { asset_id: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `readylayer.${eventType}`,
      payload,
      traceId,
      module: 'core',
      subjectType: 'asset',
      subjectId: payload.asset_id,
    })
  }

  /**
   * Submit a CDN/cache event
   */
  async submitCacheEvent(
    eventType: 'cache.purge' | 'cache.warmup' | 'cache.hit_miss_anomaly',
    payload: { paths?: string[]; zone?: string; [key: string]: unknown },
    traceId?: string
  ) {
    return this.submitEvent({
      eventType: `readylayer.${eventType}`,
      payload,
      traceId,
      module: 'core',
    })
  }

  /**
   * Submit an ops-related event
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
   * Request asset optimization job
   */
  async requestAssetOptimization(
    assetId: string,
    sourceUrl: string,
    options?: { formats?: string[]; sizes?: number[]; quality?: number; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'readylayer.asset.optimize',
      inputs: {
        asset_id: assetId,
        source_url: sourceUrl,
        tenant_id: this.getConfig().tenantId,
        formats: options?.formats || ['webp', 'avif'],
        sizes: options?.sizes || [320, 640, 1280, 1920],
        quality: options?.quality || 85,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request CDN cache purge
   */
  async requestCachePurge(
    paths: string[],
    options?: { purgeType?: 'soft' | 'hard'; zones?: string[]; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'readylayer.cache.purge',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        paths,
        purge_type: options?.purgeType || 'soft',
        zones: options?.zones,
      },
      traceId: options?.traceId,
    })
  }

  /**
   * Request analytics aggregation
   */
  async requestAnalyticsAggregation(
    startDate: string,
    endDate: string,
    options?: { metrics?: string[]; groupBy?: 'hour' | 'day' | 'week'; traceId?: string }
  ) {
    return this.requestJob({
      templateKey: 'readylayer.analytics.aggregate',
      inputs: {
        tenant_id: this.getConfig().tenantId,
        start_date: startDate,
        end_date: endDate,
        metrics: options?.metrics || ['bandwidth', 'requests', 'cache_hit_ratio'],
        group_by: options?.groupBy || 'day',
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
}

/**
 * Create a ReadyLayer adapter instance
 *
 * @param tenantId - Optional tenant ID (uses JOBFORGE_TENANT_MAPPING if not provided)
 * @param projectId - Optional project ID (uses JOBFORGE_PROJECT_MAPPING if not provided)
 * @param client - Optional JobForgeClient instance
 *
 * Environment:
 * - JOBFORGE_INTEGRATION_ENABLED=0 - Master enablement flag (default: disabled)
 * - JOBFORGE_READYLAYER_ENABLED=1 - App-specific override
 * - JOBFORGE_TENANT_MAPPING=readylayer:uuid1,keys:uuid2
 * - JOBFORGE_PROJECT_MAPPING=readylayer:proj1,keys:proj2
 * - SUPABASE_URL - Supabase project URL
 * - SUPABASE_SERVICE_ROLE_KEY - Supabase service role key
 */
export function createReadyLayerAdapter(
  tenantId?: string,
  projectId?: string,
  client?: JobForgeClient
): ReadyLayerAdapter {
  return new ReadyLayerAdapter(tenantId, projectId, client)
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
 * Create trace context for a ReadyLayer operation
 */
export function createReadyLayerTraceContext(tenantId: string, actorId?: string): TraceContext {
  return {
    trace_id: crypto.randomUUID(),
    tenant_id: tenantId,
    source_app: 'readylayer',
    actor_id: actorId,
    started_at: new Date().toISOString(),
  }
}

// ============================================================================
// Integration Examples
// ============================================================================

export const READYLAYER_INTEGRATION_EXAMPLE = `
// Server action with execution plane integration
'use server';

import { createReadyLayerAdapter, extractTraceFromHeaders } from '@jobforge/adapter-readylayer';

const adapter = createReadyLayerAdapter();

export async function optimizeAsset(assetId: string, sourceUrl: string, headers: Headers) {
  // Extract trace from incoming request
  const traceId = extractTraceFromHeaders(headers);
  
  // Submit event (requires JOBFORGE_INTEGRATION_ENABLED=1)
  await adapter.submitAssetEvent('asset.uploaded', { asset_id: assetId }, traceId);
  
  // Request optimization job (dry-run by default until enabled)
  const result = await adapter.requestAssetOptimization(assetId, sourceUrl, { traceId });
  
  return { 
    job_id: result?.job?.id, 
    trace_id: result?.trace_id || traceId 
  };
}
`
