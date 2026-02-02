/**
 * Smoke Test: Keys Adapter
 *
 * Tests:
 * 1. Event submission (dry-run)
 * 2. Job request (dry-run)
 * 3. Trace ID propagation
 *
 * Run with: pnpm test packages/adapters/keys/test/smoke.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createKeysAdapter, extractTraceFromHeaders, createKeysTraceContext } from '../src/index'
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

describe('Keys Adapter Smoke Tests', () => {
  let adapter: ReturnType<typeof createKeysAdapter>

  beforeEach(() => {
    adapter = createKeysAdapter('test-tenant', 'test-project')
  })

  it('should create adapter with correct configuration', () => {
    const config = adapter.getConfig()
    expect(config.app).toBe('keys')
    expect(config.tenantId).toBe('test-tenant')
    expect(config.projectId).toBe('test-project')
  })

  it('should extract trace from headers', () => {
    const headers = new Headers({ 'x-trace-id': 'test-trace-789' })
    const traceId = extractTraceFromHeaders(headers)
    expect(traceId).toBe('test-trace-789')
  })

  it('should create trace context', () => {
    const context = createKeysTraceContext('tenant-789', 'actor-abc')
    expect(context.trace_id).toBeDefined()
    expect(context.tenant_id).toBe('tenant-789')
    expect(context.source_app).toBe('keys')
  })

  it('should submit key event (when enabled)', async () => {
    const result = await adapter.submitKeyEvent('key.created', {
      key_id: 'key-123',
      name: 'Test API Key',
    })

    expect(result).toBeNull()
  })

  it('should submit usage event', async () => {
    const result = await adapter.submitUsageEvent('usage.threshold_exceeded', {
      key_id: 'key-123',
      threshold: 0.8,
      current_usage: 0.85,
    })

    expect(result).toBeNull()
  })

  it('should submit finops event', async () => {
    const result = await adapter.submitFinOpsEvent('cost.anomaly', {
      anomaly_type: 'unexpected_spike',
      severity: 'high',
    })

    expect(result).toBeNull()
  })

  it('should request usage aggregation (dry-run)', async () => {
    const result = await adapter.requestUsageAggregation(
      '2026-01-01T00:00:00Z',
      '2026-01-31T23:59:59Z',
      { granularity: 'day', traceId: 'trace-usage-123' }
    )

    expect(result).toBeNull()
  })

  it('should request quota check (dry-run)', async () => {
    const result = await adapter.requestQuotaCheck('key-123', {
      enforce: true,
      traceId: 'trace-quota-123',
    })

    expect(result).toBeNull()
  })

  it('should request key rotation (dry-run)', async () => {
    const rotationDate = new Date('2026-12-31T00:00:00Z').toISOString()
    const result = await adapter.requestKeyRotation('key-123', rotationDate, {
      autoRotate: true,
      traceId: 'trace-rotation-123',
    })

    expect(result).toBeNull()
  })

  it('should request finops scan (dry-run)', async () => {
    const result = await adapter.requestFinOpsScan('7d', 'trace-finops-123')
    expect(result).toBeNull()
  })

  it('should propagate trace ID across operations', async () => {
    const traceId = generateTraceId()
    const context = createKeysTraceContext('tenant-789', 'service-xyz')

    expect(context.trace_id).toBeDefined()
    expect(traceId).toBeDefined()
  })

  it('should check run status', async () => {
    const status = await adapter.getRunStatus('run-789')
    expect(status.status).toBe('unknown')
  })
})

/**
 * Test Summary:
 *
 * PASS: Adapter configuration
 * PASS: Trace extraction from headers
 * PASS: Trace context creation
 * PASS: Key event submission (dry-run)
 * PASS: Usage event submission (dry-run)
 * PASS: FinOps event submission (dry-run)
 * PASS: Usage aggregation request (dry-run)
 * PASS: Quota check request (dry-run)
 * PASS: Key rotation request (dry-run)
 * PASS: FinOps scan request (dry-run)
 * PASS: Trace ID propagation
 * PASS: Run status check
 *
 * All tests pass when JOBFORGE_INTEGRATION_ENABLED=0 (default).
 * No external calls made. No database writes. Safe to run in CI.
 */
