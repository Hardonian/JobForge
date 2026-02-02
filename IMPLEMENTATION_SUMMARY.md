# JobForge Execution Plane - Implementation Summary

**Completed**: 2026-02-02  
**Version**: 0.2.0  
**Status**: ✅ Complete

---

## Deliverables

### 1. Reality Map

**File**: `docs/REALITY_MAP.md`

Comprehensive assessment of JobForge's current state with:

- Current database schema and RPC functions
- Existing types and SDK methods
- Worker architecture and handlers
- Adapter patterns
- Gaps identified for execution plane requirements

---

### 2. Database Migration

**File**: `supabase/migrations/002_execution_plane.sql`

New tables added:

- `jobforge_events` - Standard event envelope storage
- `jobforge_artifact_manifests` - Canonical manifest storage
- `jobforge_job_templates` - Autopilot job template registry
- `jobforge_audit_logs` - Audit trail for events/job requests
- `jobforge_triggers` - Cron and event-driven triggers

New RPC functions:

- `jobforge_submit_event()` - Ingest event envelope
- `jobforge_request_job()` - Request autopilot job execution
- `jobforge_create_manifest()` - Create artifact manifest
- `jobforge_get_manifest()` - Retrieve manifest by run_id
- `jobforge_list_events()` - Query events with filters

Seed data: 12 autopilot templates (all disabled by default)

---

### 3. Execution Plane Types & Schemas

**Files**: `packages/shared/src/execution-plane/`

| File                | Contents                                                            |
| ------------------- | ------------------------------------------------------------------- |
| `events.ts`         | EventEnvelope, EventRow, SubmitEventParams, ListEventsParams        |
| `manifests.ts`      | ArtifactManifest, ManifestRow, ArtifactOutput, RunMetrics           |
| `templates.ts`      | JobTemplate, TemplateRow, RequestJobParams, AUTOPILOT_TEMPLATE_KEYS |
| `policy.ts`         | PolicyToken, PolicyCheckResult, AuditLogEntry                       |
| `triggers.ts`       | Trigger, TriggerType, CreateCronTriggerParams                       |
| `schemas.ts`        | Zod schemas for all execution plane types                           |
| `policy-utils.ts`   | generatePolicyToken, validatePolicyToken, redactPayload             |
| `manifest-utils.ts` | generateManifestReport, generateEnvFingerprint                      |

---

### 4. Feature Flags

**File**: `packages/shared/src/feature-flags.ts`

All features **disabled by default**:

- `JOBFORGE_EVENTS_ENABLED=0`
- `JOBFORGE_TRIGGERS_ENABLED=0`
- `JOBFORGE_AUTOPILOT_JOBS_ENABLED=0`
- `JOBFORGE_ACTION_JOBS_ENABLED=0`
- `JOBFORGE_AUDIT_LOGGING_ENABLED=0`
- `JOBFORGE_MANIFESTS_ENABLED=0`

Policy token settings:

- `JOBFORGE_REQUIRE_POLICY_TOKENS=1` (default ON when action jobs enabled)
- `JOBFORGE_POLICY_TOKEN_SECRET` (must be set in production)
- `JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS=1`

---

### 5. Extended SDK Client

**File**: `packages/sdk-ts/src/client.ts`

New methods added:

- `submitEvent(params)` - Event ingestion (requires EVENTS_ENABLED=1)
- `listEvents(params)` - Event querying (requires EVENTS_ENABLED=1)
- `requestJob(params)` - Request autopilot job from template
- `getRunManifest(params)` - Retrieve artifact manifest

---

### 6. Documentation

**Files**:

- `docs/execution-plane-contract.md` - Complete contract specification
- `docs/runnerless-modules-integration.md` - Integration examples for Settler/AIAS/Keys/ReadyLayer

---

### 7. Smoke Test Script

**File**: `scripts/smoke-test-execution-plane.ts`

Tests:

- Feature flags default to OFF
- Backward compatibility (existing jobs work)
- New features are no-ops when disabled
- Policy token utilities work
- Manifest utilities work

---

## Verification Results

✅ **Build**: TypeScript packages build successfully  
✅ **Typecheck**: TypeScript type checking passes  
✅ **Lint**: TypeScript linting passes  
⚠️ **Python packages**: Fail on Windows (require `make` - expected)

---

## Files Changed/Added

### New Files (19)

```
supabase/migrations/002_execution_plane.sql
docs/REALITY_MAP.md
docs/execution-plane-contract.md
docs/runnerless-modules-integration.md
packages/shared/src/feature-flags.ts
packages/shared/src/execution-plane/index.ts
packages/shared/src/execution-plane/events.ts
packages/shared/src/execution-plane/manifests.ts
packages/shared/src/execution-plane/templates.ts
packages/shared/src/execution-plane/policy.ts
packages/shared/src/execution-plane/triggers.ts
packages/shared/src/execution-plane/schemas.ts
packages/shared/src/execution-plane/policy-utils.ts
packages/shared/src/execution-plane/manifest-utils.ts
scripts/smoke-test-execution-plane.ts
```

### Modified Files (4)

```
turbo.json (pipeline → tasks for Turbo 2.0 compatibility)
packages/shared/src/index.ts (add exports)
packages/sdk-ts/src/client.ts (add execution plane methods)
packages/sdk-ts/src/index.ts (add exports)
```

---

## Migration Instructions

### 1. Apply Database Migration

```bash
cd supabase
supabase db push
# Or:
psql -U postgres -d your_database -f supabase/migrations/002_execution_plane.sql
```

### 2. Enable Features (Optional)

```bash
# .env file
JOBFORGE_EVENTS_ENABLED=1
JOBFORGE_MANIFESTS_ENABLED=1
JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
JOBFORGE_POLICY_TOKEN_SECRET=your-secret-here
```

### 3. Enable Templates

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

---

## Integration Contract Summary

For Settler/AIAS/Keys/ReadyLayer apps:

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const jobforge = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Submit events
await jobforge.submitEvent({ tenant_id, event_type, trace_id, source_app, payload })

// Request jobs
const { job, trace_id } = await jobforge.requestJob({
  tenant_id,
  template_key: 'autopilot.ops.scan',
  inputs: { target: 'production' },
  dry_run: false,
})

// Get manifest
const manifest = await jobforge.getRunManifest({ run_id: job.id, tenant_id })
```

---

## Security Checklist

- [x] All new features feature-flagged (default OFF)
- [x] Action jobs require policy tokens
- [x] PII redaction support in events
- [x] Tenant-scoped access (RLS policies)
- [x] Audit logging for all write operations
- [x] No secrets in logs (redaction hints)
- [x] Stable IDs and deterministic outputs

---

## MCP Readiness

Primitives map to MCP tools:

- `jobforge.events.ingest` → `submitEvent()`
- `jobforge.jobs.request` → `requestJob()`
- `jobforge.jobs.status` → `getJob()`
- `jobforge.artifacts.manifest.get` → `getRunManifest()`
- `jobforge.events.list` → `listEvents()`

---

## Next Steps for Module Development

1. **ops-autopilot**: Request `autopilot.ops.scan`, `autopilot.ops.diagnose`, `autopilot.ops.recommend`
2. **support-autopilot**: Request `autopilot.support.triage`, `autopilot.support.draft_reply`
3. **growth-autopilot**: Request `autopilot.growth.seo_scan`, `autopilot.growth.content_draft`
4. **finops-autopilot**: Request `autopilot.finops.anomaly_scan`, `autopilot.finops.churn_risk_report`

Each module submits events via `submitEvent()` and requests jobs via `requestJob()`.
