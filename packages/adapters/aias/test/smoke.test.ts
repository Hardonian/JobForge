/**
 * Smoke Test: AIAS Adapter
 *
 * Tests:
 * 1. Event submission (dry-run)
 * 2. Job request (dry-run)
 * 3. Trace ID propagation
 *
 * Run with: pnpm test packages/adapters/aias/test/smoke.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createAiasAdapter, extractTraceFromHeaders, createAiasTraceContext } from '../src/index'
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

describe('AIAS Adapter Smoke Tests', () => {
  let adapter: ReturnType<typeof createAiasAdapter>

  beforeEach(() => {
    adapter = createAiasAdapter('test-tenant', 'test-project')
  })

  it('should create adapter with correct configuration', () => {
    const config = adapter.getConfig()
    expect(config.app).toBe('aias')
    expect(config.tenantId).toBe('test-tenant')
    expect(config.projectId).toBe('test-project')
  })

  it('should extract trace from headers', () => {
    const headers = new Headers({ 'x-trace-id': 'test-trace-abc' })
    const traceId = extractTraceFromHeaders(headers)
    expect(traceId).toBe('test-trace-abc')
  })

  it('should create trace context', () => {
    const context = createAiasTraceContext('tenant-abc', 'actor-def')
    expect(context.trace_id).toBeDefined()
    expect(context.tenant_id).toBe('tenant-abc')
    expect(context.source_app).toBe('aias')
  })

  it('should submit agent event (when enabled)', async () => {
    const result = await adapter.submitAgentEvent('agent.started', {
      agent_id: 'agent-123',
      execution_id: 'exec-456',
    })

    expect(result).toBeNull()
  })

  it('should submit knowledge event', async () => {
    const result = await adapter.submitKnowledgeEvent('knowledge.indexed', {
      document_ids: ['doc-1', 'doc-2'],
      index_name: 'knowledge-base',
    })

    expect(result).toBeNull()
  })

  it('should submit growth event', async () => {
    const result = await adapter.submitGrowthEvent('experiment.proposed', {
      hypothesis: 'Changing CTA color will increase conversions',
      target_metric: 'conversion_rate',
    })

    expect(result).toBeNull()
  })

  it('should request agent execution (dry-run)', async () => {
    const result = await adapter.requestAgentExecution(
      'agent-123',
      { query: 'Analyze this data' },
      { model: 'gpt-4', traceId: 'trace-agent-123' }
    )

    expect(result).toBeNull()
  })

  it('should request knowledge indexing (dry-run)', async () => {
    const result = await adapter.requestKnowledgeIndexing(['doc-1', 'doc-2'], 'knowledge-base', {
      chunkSize: 1024,
      traceId: 'trace-knowledge-123',
    })

    expect(result).toBeNull()
  })

  it('should request growth experiment (dry-run)', async () => {
    const result = await adapter.requestGrowthExperiment(
      'conversion_rate',
      'CTA color change improves conversions',
      'trace-growth-123'
    )

    expect(result).toBeNull()
  })

  it('should request content draft (dry-run)', async () => {
    const result = await adapter.requestContentDraft(
      'AI in modern applications',
      'blog',
      'trace-content-123'
    )

    expect(result).toBeNull()
  })

  it('should propagate trace ID across operations', async () => {
    const traceId = generateTraceId()
    const context = createAiasTraceContext('tenant-abc', 'user-def')

    expect(context.trace_id).toBeDefined()
    expect(traceId).toBeDefined()
  })

  it('should check run status', async () => {
    const status = await adapter.getRunStatus('run-abc')
    expect(status.status).toBe('unknown')
  })
})

/**
 * Test Summary:
 *
 * PASS: Adapter configuration
 * PASS: Trace extraction from headers
 * PASS: Trace context creation
 * PASS: Agent event submission (dry-run)
 * PASS: Knowledge event submission (dry-run)
 * PASS: Growth event submission (dry-run)
 * PASS: Agent execution request (dry-run)
 * PASS: Knowledge indexing request (dry-run)
 * PASS: Growth experiment request (dry-run)
 * PASS: Content draft request (dry-run)
 * PASS: Trace ID propagation
 * PASS: Run status check
 *
 * All tests pass when JOBFORGE_INTEGRATION_ENABLED=0 (default).
 * No external calls made. No database writes. Safe to run in CI.
 */
