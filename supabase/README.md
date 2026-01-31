# JobForge Database Schema

## Quick Start

### Apply Migrations

For **Supabase**:
```bash
# Option 1: Via Supabase CLI
supabase db push

# Option 2: Via SQL Editor in Supabase Dashboard
# Copy/paste contents of migrations/001_jobforge_core.sql
```

For **Standalone Postgres**:
```bash
psql -U postgres -d your_database -f supabase/migrations/001_jobforge_core.sql
```

### Test RLS Isolation

```bash
psql -U postgres -d your_database -f supabase/tests/test_rls_isolation.sql
```

Expected output: All tests pass, confirming tenant isolation.

## Schema Overview

### Tables

- **jobforge_jobs**: Main job queue table
- **jobforge_job_results**: Stores job execution results
- **jobforge_job_attempts**: Records each execution attempt for debugging
- **jobforge_connector_configs**: Tenant-specific connector configurations

### RPC Functions

All mutations happen via RPC (Row Level Security enforced):

- `jobforge_enqueue_job()`: Enqueue a new job with idempotency
- `jobforge_claim_jobs()`: Claim jobs for processing (uses FOR UPDATE SKIP LOCKED)
- `jobforge_heartbeat_job()`: Update heartbeat for running job
- `jobforge_complete_job()`: Complete job (handles retries + dead-letter)
- `jobforge_cancel_job()`: Cancel a queued job
- `jobforge_reschedule_job()`: Reschedule a job
- `jobforge_list_jobs()`: List jobs with filters

### RLS Policies

- Tenants can only SELECT their own jobs (via `app.tenant_id` setting)
- Direct INSERT/UPDATE/DELETE blocked (must use RPC)
- Cross-tenant reads are prevented

### Indexes

Optimized for:
- Job claiming (status, run_at)
- Idempotency lookups
- Type and status filtering
- Tenant isolation

## Status Transitions

```
queued → running → succeeded
                 → failed → (retry) → queued
                          → (max retries) → dead

queued → canceled
running → canceled (admin only)
```

## Concurrency Safety

- Uses `FOR UPDATE SKIP LOCKED` for claim operations
- Worker lock ownership verified in heartbeat/complete RPCs
- Exponential backoff for retries (1s → 2s → 4s → ... → 3600s max)

## Idempotency

Jobs with the same `(tenant_id, type, idempotency_key)` are deduplicated:
- First enqueue: creates job
- Subsequent enqueues: returns existing job (no-op)

## Observability

- All timestamps tracked (created_at, started_at, finished_at, etc.)
- Heartbeat tracking for long-running jobs
- Attempt history in `jobforge_job_attempts`
