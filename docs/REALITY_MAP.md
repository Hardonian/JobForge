# JobForge Execution Plane - Reality Map

**Generated**: 2026-02-02  
**Purpose**: Assessment of JobForge repo readiness for runnerless autopilot modules  
**Target**: Serve as execution substrate for ops-autopilot, support-autopilot, growth-autopilot, finops-autopilot

---

## Executive Summary

JobForge is a **production-grade, Postgres-native job queue** with strong multi-tenant isolation via RLS. It provides a solid foundation but requires extensions to serve as an execution plane for runnerless autopilot modules.

**Current State**: Functional job queue with workers, connectors, and SDKs  
**Target State**: Execution plane with event ingestion, artifact manifests, job templates, policy gating

---

## 1. Database Layer

### File: `supabase/migrations/001_jobforge_core.sql`

#### Current Tables

| Table                        | Purpose            | Tenant-Scoped | Key Fields                                                |
| ---------------------------- | ------------------ | ------------- | --------------------------------------------------------- |
| `jobforge_jobs`              | Job queue          | ✅ Yes        | id, tenant_id, type, payload, status, attempts, locked_by |
| `jobforge_job_results`       | Execution results  | ✅ Yes        | id, job_id, tenant_id, result, artifact_ref               |
| `jobforge_job_attempts`      | Attempt history    | ✅ Yes        | id, job_id, tenant_id, attempt_no, error                  |
| `jobforge_connector_configs` | Connector settings | ✅ Yes        | id, tenant_id, connector_type, config                     |

#### State Machine

```
queued → running → succeeded
     ↓         ↓
     └── running → failed ──┬── retry → queued
                            └── max attempts → dead
```

#### RPC Functions

- `jobforge_enqueue_job()` - Enqueue with idempotency
- `jobforge_claim_jobs()` - Worker claims jobs (FOR UPDATE SKIP LOCKED)
- `jobforge_heartbeat_job()` - Keepalive for running jobs
- `jobforge_complete_job()` - Complete with retry/dead-letter logic
- `jobforge_cancel_job()` - Cancel queued jobs
- `jobforge_reschedule_job()` - Reschedule failed jobs
- `jobforge_list_jobs()` - List with filters

#### RLS Policies

- ✅ SELECT allowed with tenant_id check
- ✅ All mutations blocked (RPC-only writes)
- ✅ Strict tenant isolation via `current_setting('app.tenant_id')`

#### Gaps for Execution Plane

| Gap                         | Severity | Notes                                |
| --------------------------- | -------- | ------------------------------------ |
| No events table             | HIGH     | Need event envelope storage          |
| No artifact_manifests table | HIGH     | Need structured manifest storage     |
| No job_templates table      | HIGH     | Need autopilot job type registry     |
| No audit_logs table         | MEDIUM   | Need audit trail for events/requests |
| No triggers table           | MEDIUM   | Need cron/event trigger storage      |
| No project_id field         | MEDIUM   | Only tenant_id, need project scoping |

---

## 2. Shared Types

### Files

- `packages/shared/src/types.ts`
- `packages/shared/src/schemas.ts`
- `packages/shared/src/constants.ts`

#### Current Types

- `JobStatus` - 'queued' | 'running' | 'succeeded' | 'failed' | 'dead' | 'canceled'
- `JobRow` - Complete job record interface
- `JobResultRow` - Job execution result
- `JobAttemptRow` - Attempt history entry
- `ConnectorConfigRow` - Connector configuration
- `JobContext` - Handler execution context
- `JobHandler<TPayload, TResult>` - Handler function signature
- `JobTypeRegistry` - Handler registration interface

#### Zod Schemas

- `jobStatusSchema` - Runtime validation
- `jobRowSchema` - Full job validation
- `enqueueJobParamsSchema` - Enqueue params
- `completeJobParamsSchema` - Complete params

#### Gaps for Execution Plane

| Gap                      | Severity | Notes                             |
| ------------------------ | -------- | --------------------------------- |
| No EventEnvelope type    | HIGH     | Canonical event structure         |
| No ArtifactManifest type | HIGH     | Manifest structure for runs       |
| No JobTemplate type      | HIGH     | Autopilot job template definition |
| No PolicyToken type      | MEDIUM   | Policy token validation           |
| No AuditLog type         | MEDIUM   | Audit trail entry                 |
| No Trigger type          | MEDIUM   | Scheduling trigger definition     |

---

## 3. SDK Client

### File: `packages/sdk-ts/src/client.ts`

#### Current Methods

- `enqueueJob(params)` - Enqueue a job
- `claimJobs(params)` - Worker claim jobs
- `heartbeatJob(params)` - Job heartbeat
- `completeJob(params)` - Complete job
- `cancelJob(params)` - Cancel job
- `rescheduleJob(params)` - Reschedule job
- `listJobs(params)` - List jobs
- `getJob(jobId, tenantId)` - Get single job
- `getResult(resultId, tenantId)` - Get result

#### Gaps for Execution Plane

| Gap                      | Severity | Notes                                  |
| ------------------------ | -------- | -------------------------------------- |
| No submitEvent()         | HIGH     | Event ingestion for runnerless modules |
| No requestJob()          | HIGH     | Request autopilot job execution        |
| No getRunManifest()      | HIGH     | Retrieve run manifest                  |
| No validatePolicyToken() | MEDIUM   | Policy token validation                |
| No queryEvents()         | MEDIUM   | Event querying by tenant/project       |

---

## 4. Worker Architecture

### Files

- `services/worker-ts/src/lib/worker.ts`
- `services/worker-ts/src/lib/registry.ts`

#### Current Capabilities

- Poll-based job claiming
- Concurrent job processing
- Heartbeat tracking
- Graceful shutdown
- Handler registry pattern

#### Built-in Handlers

- `connector.http.request` - HTTP requests with SSRF protection
- `connector.webhook.deliver` - Webhook delivery with HMAC
- `connector.report.generate` - Report generation

#### Gaps for Execution Plane

| Gap                             | Severity | Notes                           |
| ------------------------------- | -------- | ------------------------------- |
| No event-driven triggers        | HIGH     | Only polling, no event triggers |
| No artifact manifest generation | HIGH     | Jobs don't output manifests     |
| No dry-run mode                 | MEDIUM   | Can't simulate job execution    |
| No job template registry        | HIGH     | Templates stored in code only   |

---

## 5. Adapters (Integration Points)

### Files

- `packages/adapters/settler/src/index.ts`
- `packages/adapters/readylayer/src/index.ts`
- `packages/adapters/keys/src/index.ts`
- `packages/adapters/aias/src/index.ts`

#### Current Pattern

Adapters define job type constants and payload schemas. They do NOT implement handlers - they provide type definitions for specific SaaS integrations.

#### Job Types Defined

- **Settler**: `settler.contract.process`, `settler.notification.send`, `settler.report.monthly`
- **ReadyLayer**: `readylayer.asset.optimize`, `readylayer.cache.purge`, `readylayer.analytics.aggregate`
- **Keys**: `keys.usage.aggregate`, `keys.quota.check`, `keys.rotation.schedule`
- **AIAS**: `aias.agent.execute`, `aias.knowledge.index`

#### Gaps for Execution Plane

| Gap                          | Severity | Notes                          |
| ---------------------------- | -------- | ------------------------------ |
| Adapters are schema-only     | MEDIUM   | No runtime behavior defined    |
| No autopilot module adapters | HIGH     | Need ops/support/growth/finops |

---

## 6. Configuration & Feature Flags

### Files

- `services/worker-ts/.env.example`
- `packages/database/.env.example`

#### Current Environment Variables

```
WORKER_ID=worker-ts-1
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
POLL_INTERVAL_MS=2000
HEARTBEAT_INTERVAL_MS=30000
CLAIM_LIMIT=10
```

#### Gaps for Execution Plane

| Gap                     | Severity | Notes                              |
| ----------------------- | -------- | ---------------------------------- |
| No feature flags        | HIGH     | Need JOBFORGE_EVENTS_ENABLED, etc. |
| No policy token config  | MEDIUM   | Need policy enforcement settings   |
| No autopilot job config | MEDIUM   | Need autopilot enable/disable      |

---

## Summary: Required Additions

### Critical (Must Add)

1. **Events System** - Event envelope schema, storage, ingestion API
2. **Artifact Manifests** - Manifest schema, storage, generation
3. **Job Templates** - Template registry for autopilot jobs
4. **Policy Tokens** - Scope gating for write actions
5. **Feature Flags** - All new features off by default

### Important (Should Add)

1. **Audit Logging** - Trail of event ingestion and job requests
2. **Triggers** - Cron and event-driven scheduling
3. **Project Scoping** - project_id alongside tenant_id
4. **MCP Readiness** - Ensure primitives can be exposed

### Optional (Nice to Have)

1. **Dry-run Mode** - Simulate job execution
2. **Manifest Renderer** - Markdown report generation
3. **Event Query API** - Filter events by type/time/tenant

---

## File Inventory

### Core Files (Existing)

```
supabase/migrations/001_jobforge_core.sql
packages/shared/src/types.ts
packages/shared/src/schemas.ts
packages/shared/src/constants.ts
packages/shared/src/index.ts
packages/sdk-ts/src/client.ts
packages/sdk-ts/src/index.ts
services/worker-ts/src/lib/worker.ts
services/worker-ts/src/lib/registry.ts
services/worker-ts/src/lib/logger.ts
services/worker-ts/src/handlers/index.ts
services/worker-ts/src/handlers/http-request.ts
services/worker-ts/src/handlers/webhook-deliver.ts
services/worker-ts/src/handlers/report-generate.ts
```

### New Files (To Create)

```
supabase/migrations/002_execution_plane.sql
packages/shared/src/execution-plane/
  - events.ts
  - manifests.ts
  - templates.ts
  - policy.ts
  - audit.ts
packages/sdk-ts/src/execution-plane.ts
packages/shared/src/feature-flags.ts
scripts/smoke-test-execution-plane.ts
docs/execution-plane-contract.md
docs/runnerless-modules-integration.md
```

---

## Verification Checklist

- [ ] Database migration applies cleanly
- [ ] Existing jobs continue to work
- [ ] Feature flags default to OFF
- [ ] No breaking changes to existing SDK methods
- [ ] Lint passes
- [ ] Typecheck passes
- [ ] Smoke test passes
