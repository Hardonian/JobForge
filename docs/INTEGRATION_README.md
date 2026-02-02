# JobForge Integration Guide

**Cross-Repo Integration for Settler, ReadyLayer, Keys, and AIAS**

This document describes how to integrate the JobForge execution plane client into all four applications.

## Quick Start

### 1. Install the Adapter Package

Each app installs its respective adapter package:

```bash
# For Settler
pnpm add @jobforge/adapter-settler

# For ReadyLayer
pnpm add @jobforge/adapter-readylayer

# For Keys
pnpm add @jobforge/adapter-keys

# For AIAS
pnpm add @jobforge/adapter-aias
```

### 2. Configure Environment Variables

Add to your `.env` file:

```bash
# Master enablement (DISABLED by default - safe for production)
JOBFORGE_INTEGRATION_ENABLED=0

# Dry-run mode (default: true) - logs what would happen without creating jobs
JOBFORGE_INTEGRATION_DRY_RUN=1

# Supabase credentials
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Tenant/Project mapping (optional - can also pass to constructor)
JOBFORGE_TENANT_MAPPING=settler:uuid1,readylayer:uuid2,keys:uuid3,aias:uuid4
JOBFORGE_PROJECT_MAPPING=settler:proj1,readylayer:proj2,keys:proj3,aias:proj4
```

### 3. Enable Integration

When ready to enable in production:

```bash
JOBFORGE_INTEGRATION_ENABLED=1
JOBFORGE_INTEGRATION_DRY_RUN=0
```

## Usage Patterns

### Pattern A: Server Action (Next.js App Router)

```typescript
// app/actions/contract.ts
'use server'

import { createSettlerAdapter, extractTraceFromHeaders } from '@jobforge/adapter-settler'

const adapter = createSettlerAdapter()

export async function processContract(contractId: string, documentUrl: string, headers: Headers) {
  // Extract trace from incoming request
  const traceId = extractTraceFromHeaders(headers)

  // 1. Submit event
  await adapter.submitContractEvent(
    'contract.created',
    {
      contract_id: contractId,
    },
    traceId
  )

  // 2. Request job (dry-run until enabled)
  const result = await adapter.requestContractProcessing(contractId, documentUrl, { traceId })

  return {
    job_id: result?.job?.id,
    trace_id: result?.trace_id || traceId,
  }
}
```

### Pattern B: API Route Handler

```typescript
// app/api/assets/[id]/optimize/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createReadyLayerAdapter, extractTraceFromHeaders } from '@jobforge/adapter-readylayer'

const adapter = createReadyLayerAdapter()

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const traceId = extractTraceFromHeaders(request.headers)
  const { source_url, formats } = await request.json()

  // Submit event
  await adapter.submitAssetEvent(
    'asset.uploaded',
    {
      asset_id: params.id,
    },
    traceId
  )

  // Request optimization
  const result = await adapter.requestAssetOptimization(params.id, source_url, { formats, traceId })

  return NextResponse.json({
    job_id: result?.job?.id,
    trace_id: result?.trace_id || traceId,
  })
}
```

### Pattern C: Background Job Worker

```typescript
// workers/keys-usage-aggregator.ts
import { createKeysAdapter } from '@jobforge/adapter-keys'

const adapter = createKeysAdapter()

export async function aggregateKeyUsage() {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  // Request usage aggregation with autopilot
  const result = await adapter.requestUsageAggregation(
    startOfDay.toISOString(),
    now.toISOString(),
    { granularity: 'hour' }
  )

  console.log('Aggregation job requested:', result?.job?.id)
}
```

### Pattern D: Tool/Function Call

```typescript
// tools/ai-agent-executor.ts
import { createAiasAdapter } from '@jobforge/adapter-aias'

const adapter = createAiasAdapter()

export async function executeAgent(agentId: string, input: unknown, traceId?: string) {
  // Use provided trace ID or generate new
  const executionTrace = traceId || adapter.generateTraceId()

  // Submit event
  await adapter.submitAgentEvent('agent.started', { agent_id: agentId }, executionTrace)

  // Request execution
  const result = await adapter.requestAgentExecution(agentId, input as Record<string, unknown>, {
    traceId: executionTrace,
  })

  return {
    job_id: result?.job?.id,
    trace_id: executionTrace,
  }
}
```

## Trace ID Propagation

All four apps share a consistent trace ID convention:

### Across HTTP Requests

Incoming requests:

```typescript
const traceId = extractTraceFromHeaders(headers) // Reads x-trace-id header
```

Outgoing requests:

```typescript
const headers = adapter.createTraceHeaders(traceId) // Sets x-trace-id header
fetch(url, { headers: { ...headers, 'Content-Type': 'application/json' } })
```

### Across Background Jobs

Jobs automatically propagate trace IDs:

```typescript
// The adapter handles trace propagation in requestJob()
const result = await adapter.requestJob({
  templateKey: 'settler.contract.process',
  inputs: { ... },
  traceId: 'trace-from-parent-request',
})
```

### Across Tool Calls

Pass trace ID through function parameters:

```typescript
async function toolFunction(input: unknown, traceId: string) {
  // Use traceId for all operations
  await adapter.submitEvent({ ...options, traceId })
}
```

## Feature Flags

### Master Enablement

| Flag                           | Default | Description                                |
| ------------------------------ | ------- | ------------------------------------------ |
| `JOBFORGE_INTEGRATION_ENABLED` | `0`     | Master switch for all integration features |
| `JOBFORGE_INTEGRATION_DRY_RUN` | `1`     | When enabled, jobs use `dry_run: true`     |

### App-Specific Overrides

| Flag                          | Description                          |
| ----------------------------- | ------------------------------------ |
| `JOBFORGE_SETTLER_ENABLED`    | Override for Settler specifically    |
| `JOBFORGE_READYLAYER_ENABLED` | Override for ReadyLayer specifically |
| `JOBFORGE_KEYS_ENABLED`       | Override for Keys specifically       |
| `JOBFORGE_AIAS_ENABLED`       | Override for AIAS specifically       |

### Example: Enable Only in Staging

```bash
# Production (.env.production)
JOBFORGE_INTEGRATION_ENABLED=0

# Staging (.env.staging)
JOBFORGE_INTEGRATION_ENABLED=1
JOBFORGE_INTEGRATION_DRY_RUN=1

# Development (.env.local)
JOBFORGE_INTEGRATION_ENABLED=1
JOBFORGE_INTEGRATION_DRY_RUN=0
```

## Tenant/Project Configuration

### Option 1: Environment Mapping (Recommended)

```bash
JOBFORGE_TENANT_MAPPING=settler:uuid1,readylayer:uuid2,keys:uuid3,aias:uuid4
JOBFORGE_PROJECT_MAPPING=settler:proj1,readylayer:proj2,keys:proj3,aias:proj4
```

### Option 2: Constructor Parameters

```typescript
const adapter = createSettlerAdapter('explicit-tenant-uuid', 'explicit-project-uuid')
```

### Option 3: Request-Scoped (Multi-tenant Apps)

```typescript
export async function handler(request: Request) {
  const tenantId = getTenantFromRequest(request)
  const adapter = createSettlerAdapter(tenantId)
  // ... use adapter
}
```

## Adapter API Reference

### Common Methods (All Adapters)

```typescript
// Event submission
adapter.submitEvent(options: SubmitEventOptions): Promise<EventRow | null>

// Job requests
adapter.requestJob(options: RequestJobOptions): Promise<RequestJobResult | null>

// Status checking
adapter.getRunManifest(runId: string): Promise<ManifestRow | null>
adapter.getRunStatus(runId: string): Promise<JobStatusResult>

// Trace utilities
adapter.generateTraceId(): string
adapter.createTraceContext(actorId?: string): TraceContext
adapter.extractTraceFromHeaders(headers: Headers): string | undefined
adapter.createTraceHeaders(traceId: string): Record<string, string>

// Configuration
adapter.isEnabled(): boolean
adapter.getConfig(): AdapterConfig
```

### App-Specific Methods

#### Settler

```typescript
adapter.submitContractEvent(eventType, payload, traceId?)
adapter.submitOpsEvent(eventType, payload, traceId?)
adapter.requestContractProcessing(contractId, documentUrl, options?)
adapter.requestOpsScan(target, traceId?)
adapter.requestMonthlyReport(year, month, traceId?)
```

#### ReadyLayer

```typescript
adapter.submitAssetEvent(eventType, payload, traceId?)
adapter.submitCacheEvent(eventType, payload, traceId?)
adapter.submitOpsEvent(eventType, payload, traceId?)
adapter.requestAssetOptimization(assetId, sourceUrl, options?)
adapter.requestCachePurge(paths, options?)
adapter.requestAnalyticsAggregation(startDate, endDate, options?)
adapter.requestOpsScan(target, traceId?)
```

#### Keys

```typescript
adapter.submitKeyEvent(eventType, payload, traceId?)
adapter.submitUsageEvent(eventType, payload, traceId?)
adapter.submitFinOpsEvent(eventType, payload, traceId?)
adapter.requestUsageAggregation(startDate, endDate, options?)
adapter.requestQuotaCheck(keyId, options?)
adapter.requestKeyRotation(keyId, rotationDate, options?)
adapter.requestFinOpsScan(timeRange, traceId?)
```

#### AIAS

```typescript
adapter.submitAgentEvent(eventType, payload, traceId?)
adapter.submitKnowledgeEvent(eventType, payload, traceId?)
adapter.submitGrowthEvent(eventType, payload, traceId?)
adapter.requestAgentExecution(agentId, inputData, options?)
adapter.requestKnowledgeIndexing(documentIds, indexName, options?)
adapter.requestGrowthExperiment(target, hypothesis, traceId?)
adapter.requestContentDraft(topic, format, traceId?)
```

## Safety Guarantees

### 1. Disabled by Default

```bash
JOBFORGE_INTEGRATION_ENABLED=0  # Nothing runs in production
```

### 2. Dry-Run Mode

```bash
JOBFORGE_INTEGRATION_DRY_RUN=1  # Logs what would happen, no jobs created
```

### 3. Null Returns When Disabled

```typescript
const result = await adapter.requestJob({ ... }) // Returns null when disabled
if (result) {
  // Only runs when enabled
}
```

### 4. Console Logging

When disabled, adapters log to console:

```
[JobForge:settler] submitEvent skipped (disabled)
[JobForge:settler] requestJob skipped (disabled)
```

## Testing

### Run Smoke Tests

```bash
# Settler
cd packages/adapters/settler && pnpm test

# ReadyLayer
cd packages/adapters/readylayer && pnpm test

# Keys
cd packages/adapters/keys && pnpm test

# AIAS
cd packages/adapters/aias && pnpm test
```

### Smoke Test Summary

Each adapter includes smoke tests that verify:

- ✅ Adapter configuration
- ✅ Trace extraction from headers
- ✅ Trace context creation
- ✅ Event submission (dry-run)
- ✅ Job requests (dry-run)
- ✅ Trace ID propagation
- ✅ Status checking

All tests pass with `JOBFORGE_INTEGRATION_ENABLED=0` (default).
No external calls. No database writes. Safe for CI.

### Manual Verification

```typescript
// Verify adapter is disabled by default
const adapter = createSettlerAdapter()
console.log('Enabled:', adapter.isEnabled()) // false

// Verify config
console.log('Config:', adapter.getConfig())
// { enabled: false, app: 'settler', tenantId: '...', dryRunDefault: true }
```

## Production Checklist

Before enabling in production:

- [ ] Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Configure `JOBFORGE_TENANT_MAPPING` or pass tenant IDs explicitly
- [ ] Configure `JOBFORGE_PROJECT_MAPPING` (optional)
- [ ] Test with `JOBFORGE_INTEGRATION_ENABLED=1` in staging
- [ ] Verify `JOBFORGE_EVENTS_ENABLED=1` on JobForge execution plane
- [ ] Verify `JOBFORGE_AUTOPILOT_JOBS_ENABLED=1` on JobForge execution plane
- [ ] Enable specific templates in JobForge database
- [ ] Monitor logs for `[JobForge:*]` entries
- [ ] Set up alerts for failed job submissions

## Rollback

To disable integration immediately:

```bash
JOBFORGE_INTEGRATION_ENABLED=0
```

Existing jobs continue to run. New submissions become no-ops.

## Support

- **Adapter Issues**: File in `packages/adapters/[app]/`
- **Integration Core**: File in `packages/integration/`
- **Execution Plane**: See `docs/execution-plane-contract.md`
