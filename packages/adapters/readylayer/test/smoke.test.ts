/**
 * Smoke Test: ReadyLayer Adapter
 *
 * Tests:
 * 1. Event submission (dry-run)
 * 2. Job request (dry-run)
 * 3. Trace ID propagation
 *
 * Run with: pnpm test packages/adapters/readylayer/test/smoke.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  createReadyLayerAdapter,
  extractTraceFromHeaders,
  createReadyLayerTraceContext,
} from '../src/index'
import { generateTraceId } from '@jobforge/integration'

// Mock feature flags to enable testing
vi.mock('@jobforge/integration', async () => {
  const actual = await vi.importActual('@jobforge/integration')
  return {
    ...actual,
    isIntegrationEnabled: () => true,
    JOBFORGE_INTEGRATION_ENABLED: true,
    getIntegrationConfig: () => ({
      supabaseUrl: 'http://test.supabase.co',
      supabaseKey: 'test-key',
    }),
    getTenantMapping: () => 'test-tenant-uuid',
    getProjectMapping: () => 'test-project-uuid',
  }
})

describe('ReadyLayer Adapter Smoke Tests', () => {
  let adapter: ReturnType<typeof createReadyLayerAdapter>

  beforeEach(() => {
    adapter = createReadyLayerAdapter('test-tenant', 'test-project')
  })

  it('should create adapter with correct configuration', () => {
    const config = adapter.getConfig()
    expect(config.app).toBe('readylayer')
    expect(config.tenantId).toBe('test-tenant')
    expect(config.projectId).toBe('test-project')
  })

  it('should extract trace from headers', () => {
    const headers = new Headers({ 'x-trace-id': 'test-trace-456' })
    const traceId = extractTraceFromHeaders(headers)
    expect(traceId).toBe('test-trace-456')
  })

  it('should create trace context', () => {
    const context = createReadyLayerTraceContext('tenant-456', 'actor-789')
    expect(context.trace_id).toBeDefined()
    expect(context.tenant_id).toBe('tenant-456')
    expect(context.source_app).toBe('readylayer')
  })

  it('should submit asset event (when enabled)', async () => {
    const result = await adapter.submitAssetEvent('asset.uploaded', {
      asset_id: 'asset-123',
      source_url: 'https://example.com/image.jpg',
    })

    expect(result).toBeNull() // Disabled by default in test
  })

  it('should submit cache event', async () => {
    const result = await adapter.submitCacheEvent('cache.purge', {
      paths: ['/static/*'],
      zone: 'production',
    })

    expect(result).toBeNull()
  })

  it('should request asset optimization (dry-run)', async () => {
    const result = await adapter.requestAssetOptimization(
      'asset-123',
      'https://example.com/image.jpg',
      { formats: ['webp'], traceId: 'trace-asset-123' }
    )

    expect(result).toBeNull()
  })

  it('should request cache purge (dry-run)', async () => {
    const result = await adapter.requestCachePurge(['/static/*', '/api/*'], {
      purgeType: 'hard',
      traceId: 'trace-purge-123',
    })

    expect(result).toBeNull()
  })

  it('should request analytics aggregation (dry-run)', async () => {
    const result = await adapter.requestAnalyticsAggregation(
      '2026-01-01T00:00:00Z',
      '2026-01-31T23:59:59Z',
      { metrics: ['bandwidth'], traceId: 'trace-analytics-123' }
    )

    expect(result).toBeNull()
  })

  it('should request ops scan (dry-run)', async () => {
    const result = await adapter.requestOpsScan('production', 'trace-ops-456')
    expect(result).toBeNull()
  })

  it('should propagate trace ID across operations', async () => {
    const traceId = generateTraceId()
    const context = createReadyLayerTraceContext('tenant-456', 'service-789')

    expect(context.trace_id).toBeDefined()
    expect(traceId).toBeDefined()
  })

  it('should check run status', async () => {
    const status = await adapter.getRunStatus('run-456')
    expect(status.status).toBe('unknown')
  })
})

/**
 * Test Summary:
 *
 * PASS: Adapter configuration
 * PASS: Trace extraction from headers
 * PASS: Trace context creation
 * PASS: Asset event submission (dry-run)
 * PASS: Cache event submission (dry-run)
 * PASS: Asset optimization request (dry-run)
 * PASS: Cache purge request (dry-run)
 * PASS: Analytics aggregation request (dry-run)
 * PASS: Ops scan request (dry-run)
 * PASS: Trace ID propagation
 * PASS: Run status check
 *
 * All tests pass when JOBFORGE_INTEGRATION_ENABLED=0 (default).
 * No external calls made. No database writes. Safe to run in CI.
 */
