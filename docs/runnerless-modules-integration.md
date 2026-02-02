# Runnerless Modules Integration Guide

**Version**: 0.2.0  
**Date**: 2026-02-02

This guide shows how the four apps (Settler, AIAS, Keys, ReadyLayer) integrate with JobForge's execution plane.

---

## Quick Start

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const jobforge = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})
```

---

## Settler Integration

Settler manages contracts and notifications.

### Submitting Contract Events

```typescript
// When a contract is uploaded
async function onContractUploaded(contractId: string, tenantId: string) {
  await jobforge.submitEvent({
    tenant_id: tenantId,
    event_type: 'settler.contract.uploaded',
    trace_id: generateTraceId(),
    source_app: 'settler',
    source_module: 'core',
    subject: {
      type: 'contract',
      id: contractId,
    },
    payload: {
      contract_id: contractId,
      status: 'pending_processing',
    },
    contains_pii: false,
  })
}
```

### Requesting Contract Processing

```typescript
// Request contract analysis
async function requestContractAnalysis(contractId: string, tenantId: string) {
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    template_key: 'settler.contract.process',
    inputs: {
      contract_id: contractId,
      analysis_type: 'full',
    },
    trace_id: generateTraceId(),
    actor_id: 'settler-service',
  })

  return {
    jobId: result.job.id,
    traceId: result.trace_id,
  }
}
```

---

## AIAS Integration

AIAS (AI Agent System) executes AI workflows and indexes knowledge.

### Submitting Agent Execution Events

```typescript
// When an agent completes a task
async function onAgentTaskComplete(agentId: string, taskId: string, tenantId: string) {
  await jobforge.submitEvent({
    tenant_id: tenantId,
    event_type: 'aias.agent.task.completed',
    trace_id: generateTraceId(),
    source_app: 'aias',
    source_module: 'core',
    subject: {
      type: 'agent_task',
      id: taskId,
    },
    payload: {
      agent_id: agentId,
      task_id: taskId,
      outcome: 'success',
    },
    contains_pii: false,
  })
}
```

### Requesting Knowledge Indexing

```typescript
// Index documents for RAG
async function indexDocuments(documentIds: string[], tenantId: string) {
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    template_key: 'aias.knowledge.index',
    inputs: {
      document_ids: documentIds,
      index_type: 'vector',
    },
    trace_id: generateTraceId(),
  })

  return result.job.id
}
```

---

## Keys Integration

Keys manages API key usage, quotas, and rotation.

### Submitting Usage Events

```typescript
// Log API key usage
async function logKeyUsage(
  keyId: string,
  usage: { requests: number; bytes: number },
  tenantId: string
) {
  await jobforge.submitEvent({
    tenant_id: tenantId,
    event_type: 'keys.usage.recorded',
    trace_id: generateTraceId(),
    source_app: 'keys',
    source_module: 'core',
    subject: {
      type: 'api_key',
      id: keyId,
    },
    payload: {
      key_id: keyId,
      requests: usage.requests,
      bytes_transferred: usage.bytes,
    },
    contains_pii: false,
  })
}
```

### Requesting Usage Aggregation

```typescript
// Aggregate usage metrics
async function aggregateUsage(tenantId: string, period: string) {
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    template_key: 'keys.usage.aggregate',
    inputs: {
      period,
      granularity: 'hourly',
    },
    trace_id: generateTraceId(),
  })

  return result.job.id
}
```

---

## ReadyLayer Integration

ReadyLayer handles asset optimization and CDN operations.

### Submitting Asset Events

```typescript
// When an asset is uploaded
async function onAssetUploaded(assetId: string, tenantId: string) {
  await jobforge.submitEvent({
    tenant_id: tenantId,
    event_type: 'readylayer.asset.uploaded',
    trace_id: generateTraceId(),
    source_app: 'readylayer',
    source_module: 'core',
    subject: {
      type: 'asset',
      id: assetId,
    },
    payload: {
      asset_id: assetId,
      optimization_pending: true,
    },
    contains_pii: false,
  })
}
```

### Requesting Asset Optimization

```typescript
// Optimize an asset for delivery
async function optimizeAsset(assetId: string, tenantId: string) {
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    template_key: 'readylayer.asset.optimize',
    inputs: {
      asset_id: assetId,
      formats: ['webp', 'avif'],
      sizes: [640, 1280, 1920],
    },
    trace_id: generateTraceId(),
  })

  return result.job.id
}
```

---

## Verification Pack Style Runs (ReadyLayer Example)

ReadyLayer can request verification-pack style runs that produce detailed manifests.

```typescript
import { generateManifestReport } from '@jobforge/shared'

async function runVerificationPack(tenantId: string, projectId: string) {
  // 1. Submit verification event
  await jobforge.submitEvent({
    tenant_id: tenantId,
    project_id: projectId,
    event_type: 'readylayer.verification.requested',
    trace_id: generateTraceId(),
    source_app: 'readylayer',
    source_module: 'ops',
    payload: {
      verification_type: 'full_audit',
      checks: ['ssl', 'performance', 'accessibility'],
    },
    contains_pii: false,
  })

  // 2. Request verification job
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    project_id: projectId,
    template_key: 'autopilot.ops.scan',
    inputs: {
      target: 'production',
      scan_type: 'performance',
      checks: ['ssl', 'cdn', 'cache'],
    },
    trace_id: generateTraceId(),
  })

  // 3. Poll for completion
  const job = await pollForCompletion(result.job.id, tenantId)

  // 4. Get manifest
  const manifest = await jobforge.getRunManifest({
    run_id: job.id,
    tenant_id: tenantId,
  })

  // 5. Generate report
  const report = generateManifestReport(manifest!, {
    include_inputs: true,
    include_metrics: true,
    include_env: true,
  })

  return {
    jobId: job.id,
    manifest,
    report,
  }
}

async function pollForCompletion(
  jobId: string,
  tenantId: string,
  maxAttempts = 60
): Promise<JobRow> {
  for (let i = 0; i < maxAttempts; i++) {
    const job = await jobforge.getJob(jobId, tenantId)

    if (!job) {
      throw new Error(`Job ${jobId} not found`)
    }

    if (job.status === 'succeeded' || job.status === 'failed') {
      return job
    }

    // Wait 1 second before next poll
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  throw new Error(`Job ${jobId} did not complete within ${maxAttempts}s`)
}
```

---

## Content Drafts (AIAS/Growth Example)

AIAS and Growth modules can request content generation.

```typescript
async function requestContentDraft(
  topic: string,
  format: 'blog' | 'email' | 'social',
  tenantId: string
) {
  // Submit content request event
  await jobforge.submitEvent({
    tenant_id: tenantId,
    event_type: 'growth.content.requested',
    trace_id: generateTraceId(),
    source_app: 'aias',
    source_module: 'growth',
    payload: {
      topic,
      format,
      requested_by: 'marketing-team',
    },
    contains_pii: false,
  })

  // Request content draft job
  const result = await jobforge.requestJob({
    tenant_id: tenantId,
    template_key: 'autopilot.growth.content_draft',
    inputs: {
      topic,
      format,
      tone: 'professional',
      target_audience: 'technical',
    },
    trace_id: generateTraceId(),
  })

  return result.job.id
}
```

---

## Error Handling

All execution plane methods throw descriptive errors:

```typescript
try {
  await jobforge.submitEvent({ ... })
} catch (error) {
  if (error.message.includes('disabled')) {
    // Feature flag is off
    console.warn('Execution plane feature not enabled')
  } else if (error.message.includes('Template is disabled')) {
    // Template not enabled
    console.warn('Template not available')
  } else {
    // Other error
    console.error('Execution plane error:', error)
  }
}
```

---

## Best Practices

1. **Always use trace_id**: Pass `trace_id` through your entire request chain for observability.

2. **Check feature flags**: Verify `getFeatureFlagSummary()` before relying on execution plane features.

3. **Handle dry_run**: Respect dry_run mode in your application logic.

4. **Redact PII**: Set `contains_pii: true` and provide `redaction_hints` for sensitive data.

5. **Poll responsibly**: Use exponential backoff when polling for job completion.

6. **Scope policy tokens**: Grant minimal required scopes for action jobs.

---

## Utility Functions

```typescript
import {
  generateTraceId,
  isEventIngestionAvailable,
  isTemplateEnabled,
  getFeatureFlagSummary,
} from '@jobforge/shared'

// Generate trace ID
function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`
}

// Check feature availability
if (!isEventIngestionAvailable()) {
  console.warn('Event ingestion is disabled')
}

// Get all feature flags
const flags = getFeatureFlagSummary()
console.log('Feature flags:', flags)
```
