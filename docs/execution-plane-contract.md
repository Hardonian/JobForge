# JobForge Execution Plane Contract

**Version**: 0.2.0  
**Date**: 2026-02-02

This document defines the contract between JobForge (the execution plane) and runnerless autopilot modules (ops, support, growth, finops).

---

## Overview

JobForge serves as the **single execution substrate** for all autopilot modules. Modules do not have their own runners, schedulers, or artifact stores - they request execution through JobForge.

```
┌─────────────────────────────────────────────────────────────┐
│                    JobForge Execution Plane                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Event      │  │   Job       │  │  Artifact   │          │
│  │  Ingestion  │  │   Queue     │  │  Manifests  │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│  │  Templates  │  │  Triggers   │  │   Policy    │          │
│  │  Registry   │  │  (Cron/     │  │   Tokens    │          │
│  │             │  │   Event)    │  │             │          │
│  └─────────────┘  └─────────────┘  └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
         ▲                    ▲                    ▲
         │                    │                    │
    ┌────┴────┐          ┌────┴────┐          ┌────┴────┐
    │  Ops    │          │ Support │          │ Growth  │
    │Autopilot│          │Autopilot│          │Autopilot│
    └─────────┘          └─────────┘          └─────────┘
         ▲                    ▲                    ▲
         └────────────────────┼────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Four Apps       │
                    │ Settler | AIAS    │
                    │ Keys | ReadyLayer │
                    └───────────────────┘
```

---

## A) Standard Event Envelope

Runnerless modules emit events using a canonical JSON envelope format.

### Event Structure

```typescript
interface EventEnvelope {
  event_version: '1.0'
  event_type: string // e.g., 'infrastructure.alert'
  occurred_at: string // ISO timestamp
  trace_id: string // Distributed tracing ID
  actor_id?: string // Optional actor
  tenant_id: string // Tenant scope (required)
  project_id?: string // Project scope (optional)
  source_app: 'settler' | 'aias' | 'keys' | 'readylayer' | 'jobforge' | 'external'
  source_module?: 'ops' | 'support' | 'growth' | 'finops' | 'core'
  subject?: {
    // Optional entity reference
    type: string
    id: string
  }
  payload: Record<string, unknown>
  contains_pii: boolean // Privacy flag
  redaction_hints?: {
    redact_fields?: string[]
    encrypt_fields?: string[]
    retention_days?: number
  }
}
```

### Submitting Events

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const client = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Submit an event (requires JOBFORGE_EVENTS_ENABLED=1)
const event = await client.submitEvent({
  tenant_id: 'tenant-123',
  event_type: 'infrastructure.alert',
  trace_id: 'trace-456',
  source_app: 'settler',
  source_module: 'ops',
  payload: {
    severity: 'warning',
    service: 'api-gateway',
    message: 'High latency detected',
  },
  contains_pii: false,
})
```

### Privacy & Redaction

Events with `contains_pii: true` are flagged for special handling:

- Fields in `redaction_hints.redact_fields` are redacted in logs
- Fields in `redaction_hints.encrypt_fields` are encrypted at rest
- Retention is enforced based on `redaction_hints.retention_days`

---

## B) Artifact Manifest Standard

Every job run produces a canonical manifest describing inputs, outputs, and metrics.

### Manifest Structure

```typescript
interface ArtifactManifest {
  manifest_version: '1.0'
  run_id: string
  tenant_id: string
  project_id?: string
  job_type: string
  created_at: string
  inputs_snapshot_ref?: string
  logs_ref?: string
  outputs: Array<{
    name: string
    type: string
    ref: string
    size?: number
    checksum?: string
    mime_type?: string
  }>
  metrics: {
    duration_ms?: number
    cpu_ms?: number
    memory_mb?: number
    cost_estimate?: number
    [key: string]: number | undefined
  }
  env_fingerprint: {
    os?: string
    arch?: string
    node_version?: string
    [key: string]: string | undefined
  }
  tool_versions: {
    jobforge?: string
    connectors?: Record<string, string>
  }
  status: 'pending' | 'complete' | 'failed'
  error?: Record<string, unknown>
}
```

### Retrieving Manifests

```typescript
// Get manifest for a run (requires JOBFORGE_MANIFESTS_ENABLED=1)
const manifest = await client.getRunManifest({
  run_id: 'job-uuid',
  tenant_id: 'tenant-123',
})

// Generate markdown report
import { generateManifestReport } from '@jobforge/shared'
const report = generateManifestReport(manifest, {
  include_inputs: true,
  include_metrics: true,
  include_env: false,
})
```

---

## C) Runnerless Job Templates Registry

Autopilot jobs are defined as templates in the registry. Templates are **disabled by default** and must be explicitly enabled.

### Template Registry

| Template Key                          | Category | Action Job | Description              |
| ------------------------------------- | -------- | ---------- | ------------------------ |
| `autopilot.ops.scan`                  | ops      | No         | Infrastructure scan      |
| `autopilot.ops.diagnose`              | ops      | No         | Issue diagnosis          |
| `autopilot.ops.recommend`             | ops      | No         | Generate recommendations |
| `autopilot.ops.apply`                 | ops      | **Yes**    | Apply changes (gated)    |
| `autopilot.support.triage`            | support  | No         | Ticket triage            |
| `autopilot.support.draft_reply`       | support  | No         | Draft replies            |
| `autopilot.support.propose_kb_patch`  | support  | No         | Propose KB updates       |
| `autopilot.growth.seo_scan`           | growth   | No         | SEO scanning             |
| `autopilot.growth.experiment_propose` | growth   | No         | Propose experiments      |
| `autopilot.growth.content_draft`      | growth   | No         | Draft content            |
| `autopilot.finops.reconcile`          | finops   | No         | Cost reconciliation      |
| `autopilot.finops.anomaly_scan`       | finops   | No         | Anomaly detection        |
| `autopilot.finops.churn_risk_report`  | finops   | No         | Churn risk reports       |

### Requesting Jobs

```typescript
// Request a non-action job (no policy token required)
const result = await client.requestJob({
  tenant_id: 'tenant-123',
  template_key: 'autopilot.ops.scan',
  inputs: {
    target: 'production',
    scan_type: 'security',
  },
  project_id: 'project-456',
  trace_id: 'trace-789',
  actor_id: 'user-abc',
})

// Dry run mode (logs what would happen, no job created)
const dryRun = await client.requestJob({
  tenant_id: 'tenant-123',
  template_key: 'autopilot.ops.scan',
  inputs: { target: 'production' },
  dry_run: true,
})
```

### Action Jobs (Policy Token Required)

Action jobs (like `autopilot.ops.apply`) require a policy token:

```typescript
import { generatePolicyToken } from '@jobforge/shared'

// Generate policy token (requires JOBFORGE_POLICY_TOKEN_SECRET)
const policyToken = generatePolicyToken({
  tenantId: 'tenant-123',
  actorId: 'user-abc',
  action: 'autopilot.ops.apply',
  scopes: ['ops:write'],
  expiresInHours: 1,
})

// Request action job with policy token
// Note: Server-side validation required
const result = await client.requestJob({
  tenant_id: 'tenant-123',
  template_key: 'autopilot.ops.apply',
  inputs: {
    changeset_id: 'change-123',
    approval_token: policyToken,
  },
})
```

---

## D) Scheduling + Triggers

JobForge provides a minimal trigger system for cron and event-driven execution.

**Note**: Triggers are disabled by default (`JOBFORGE_TRIGGERS_ENABLED=0`).

### Cron Triggers

```sql
-- Create a cron trigger (database-level)
INSERT INTO jobforge_triggers (
  tenant_id,
  trigger_type,
  name,
  cron_expression,
  target_template_key,
  target_inputs,
  enabled,
  dry_run
) VALUES (
  'tenant-123',
  'cron',
  'Daily Cost Scan',
  '0 0 * * *',  -- Daily at midnight
  'autopilot.finops.anomaly_scan',
  '{"time_range": "1d"}',
  true,
  false
);
```

### Event Triggers

```sql
-- Create an event trigger
INSERT INTO jobforge_triggers (
  tenant_id,
  trigger_type,
  name,
  event_type_filter,
  target_template_key,
  target_inputs,
  enabled
) VALUES (
  'tenant-123',
  'event',
  'Alert Response',
  'infrastructure.alert',
  'autopilot.ops.diagnose',
  '{}',
  true
);
```

### Dry Run Mode

Triggers can be created in `dry_run` mode to log what would be triggered without actually creating jobs:

```sql
INSERT INTO jobforge_triggers (...) VALUES (
  ...,
  true  -- dry_run
);
```

---

## E) Policy Tokens + Scope Gating

Policy tokens provide authorization for write actions. All action jobs require a valid policy token.

### Token Structure

```typescript
interface PolicyToken {
  id: string
  version: '1.0'
  issued_at: string
  expires_at?: string
  tenant_id: string
  project_id?: string
  actor_id: string
  scopes: string[] // e.g., ['ops:write', 'support:read']
  action: string // Action being authorized
  resource?: string // Optional resource constraint
  context?: Record<string, unknown>
  signature: string // HMAC signature
}
```

### Scope Requirements by Template

| Template                              | Required Scopes    |
| ------------------------------------- | ------------------ |
| `autopilot.ops.scan`                  | `['ops:read']`     |
| `autopilot.ops.diagnose`              | `['ops:read']`     |
| `autopilot.ops.recommend`             | `['ops:read']`     |
| `autopilot.ops.apply`                 | `['ops:write']`    |
| `autopilot.support.triage`            | `['support:read']` |
| `autopilot.support.draft_reply`       | `['support:read']` |
| `autopilot.support.propose_kb_patch`  | `['support:read']` |
| `autopilot.growth.seo_scan`           | `['growth:read']`  |
| `autopilot.growth.experiment_propose` | `['growth:read']`  |
| `autopilot.growth.content_draft`      | `['growth:read']`  |
| `autopilot.finops.reconcile`          | `['finops:read']`  |
| `autopilot.finops.anomaly_scan`       | `['finops:read']`  |
| `autopilot.finops.churn_risk_report`  | `['finops:read']`  |

### Validating Policy Tokens

```typescript
import { validatePolicyToken } from '@jobforge/shared'

const result = validatePolicyToken({
  token: policyToken,
  action: 'autopilot.ops.apply',
  required_scopes: ['ops:write'],
  tenant_id: 'tenant-123',
  actor_id: 'user-abc',
})

if (!result.allowed) {
  console.error(`Policy check failed: ${result.reason}`)
}
```

### Security Requirements

1. **Token Secret Required**: `JOBFORGE_POLICY_TOKEN_SECRET` must be set in production
2. **Expiration Enforced**: Tokens expire after `JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS` (default: 1)
3. **Scope Verification**: All required scopes must be granted
4. **Signature Validation**: Tokens must have valid HMAC signature
5. **Tenant Isolation**: Tokens are scoped to specific tenants

---

## F) Integration Surfaces

### For Settler / AIAS / Keys / ReadyLayer

Applications integrate with JobForge through the TypeScript SDK:

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const jobforge = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Submit events
await jobforge.submitEvent({ ... })

// Request jobs
const { job, trace_id } = await jobforge.requestJob({ ... })

// Check status
const run = await jobforge.getJob(job.id, tenantId)

// Get manifest
const manifest = await jobforge.getRunManifest({
  run_id: job.id,
  tenant_id: tenantId,
})
```

### Client Contract Summary

| Method             | Purpose               | Feature Flag Required          |
| ------------------ | --------------------- | ------------------------------ |
| `submitEvent()`    | Ingest event envelope | `JOBFORGE_EVENTS_ENABLED=1`    |
| `listEvents()`     | Query events          | `JOBFORGE_EVENTS_ENABLED=1`    |
| `requestJob()`     | Request autopilot job | Template `enabled=true`        |
| `getRunManifest()` | Get run manifest      | `JOBFORGE_MANIFESTS_ENABLED=1` |

---

## G) MCP Readiness

The execution plane primitives map cleanly to MCP (Model Context Protocol) tools:

| Primitive       | MCP Tool Name                     | Input Schema            | Output Schema      |
| --------------- | --------------------------------- | ----------------------- | ------------------ |
| Event Ingestion | `jobforge.events.ingest`          | `EventEnvelope`         | `EventRow`         |
| Job Request     | `jobforge.jobs.request`           | `RequestJobParams`      | `RequestJobResult` |
| Get Status      | `jobforge.jobs.status`            | `{ run_id, tenant_id }` | `JobRow`           |
| Get Manifest    | `jobforge.artifacts.manifest.get` | `GetManifestParams`     | `ArtifactManifest` |
| List Events     | `jobforge.events.list`            | `ListEventsParams`      | `EventRow[]`       |

These can be exposed via MCP server if/when JobForge adds MCP support.

---

## Feature Flags Reference

| Flag                                 | Default | Description                       |
| ------------------------------------ | ------- | --------------------------------- |
| `JOBFORGE_EVENTS_ENABLED`            | `0`     | Enable event ingestion system     |
| `JOBFORGE_TRIGGERS_ENABLED`          | `0`     | Enable scheduling triggers        |
| `JOBFORGE_AUTOPILOT_JOBS_ENABLED`    | `0`     | Enable autopilot job templates    |
| `JOBFORGE_ACTION_JOBS_ENABLED`       | `0`     | Enable action jobs (write ops)    |
| `JOBFORGE_AUDIT_LOGGING_ENABLED`     | `0`     | Enable audit logging              |
| `JOBFORGE_MANIFESTS_ENABLED`         | `0`     | Enable artifact manifests         |
| `JOBFORGE_REQUIRE_POLICY_TOKENS`     | `1`     | Require policy tokens for actions |
| `JOBFORGE_POLICY_TOKEN_SECRET`       | ``      | Secret for token signing          |
| `JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS` | `1`     | Token expiration time             |

---

## Migration Guide

### Applying Database Migration

```bash
# Via Supabase CLI
cd supabase
supabase db push

# Or via psql
psql -U postgres -d your_database -f supabase/migrations/002_execution_plane.sql
```

### Enabling Features

```bash
# .env file
JOBFORGE_EVENTS_ENABLED=1
JOBFORGE_MANIFESTS_ENABLED=1
JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
JOBFORGE_POLICY_TOKEN_SECRET=your-secret-here
```

### Enabling Templates

```sql
-- Enable specific templates
UPDATE jobforge_job_templates
SET enabled = true
WHERE template_key IN (
  'autopilot.ops.scan',
  'autopilot.support.triage'
);
```

---

## Rollback Instructions

To disable execution plane features:

```bash
# 1. Set all feature flags to 0
JOBFORGE_EVENTS_ENABLED=0
JOBFORGE_TRIGGERS_ENABLED=0
JOBFORGE_AUTOPILOT_JOBS_ENABLED=0
JOBFORGE_ACTION_JOBS_ENABLED=0
JOBFORGE_AUDIT_LOGGING_ENABLED=0
JOBFORGE_MANIFESTS_ENABLED=0

# 2. Disable all templates
UPDATE jobforge_job_templates SET enabled = false;
```

Existing jobs continue to work unchanged. New execution plane features become no-ops.
