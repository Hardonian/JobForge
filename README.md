# JobForge

- **Postgres-native job queue** with tenant isolation, retries, and idempotency enforced in SQL.
- **Supabase-first** schema and RPC functions for enqueue/claim/complete operations.
- **SDKs + workers** in TypeScript and Python for running background jobs without Redis/Kafka.
- **Operational tooling** (CLI utilities, smoke tests, replay tooling) in this monorepo.

**Who this is for:** SaaS teams running Supabase/Postgres who want a durable, multi-tenant job queue with database-enforced safety guarantees.

**Quick start:** Apply the Supabase migrations and run the TypeScript worker as shown in [Quick Start](#quick-start).

## Why This Exists

Running background jobs in multi-tenant SaaS apps often means introducing a second data store (Redis/Kafka) and re-implementing tenancy, retries, and idempotency in application code. JobForge keeps those guarantees in Postgres so:

- Job state, retries, and idempotency are transactional and durable.
- Row Level Security (RLS) protects tenant boundaries in the database.
- Workers can remain stateless and simple.

## What This Project Is

JobForge is a **Postgres-native job queue** built for Supabase/Postgres deployments. It provides:

- A database schema + RPC functions to enqueue, claim, heartbeat, complete, and reschedule jobs.
- SDKs (TypeScript, Python) to enqueue and inspect jobs.
- Worker services (TypeScript, Python) that poll and execute jobs with built-in handlers.
- CLI utilities and smoke tests for operational checks.

## What This Project Is NOT

- Not a general-purpose workflow engine or orchestration platform.
- Not a hosted service; you run the database and workers yourself.
- Not a replacement for message brokers when you need cross-system streaming.

## Where This Fits

JobForge sits between your application and background execution:

- **Inputs**: your app enqueues jobs via SDKs or RPC calls.
- **Control plane**: Postgres + Supabase RPC functions enforce queue semantics.
- **Execution**: workers poll and run job handlers.
- **Outputs**: results and attempts are stored in Postgres for auditing.

See [supabase/README.md](supabase/README.md) for the schema and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design.

## Core Capabilities

- Transactional enqueue/claim/complete via RPC functions and `FOR UPDATE SKIP LOCKED`.
- RLS-based tenant isolation at the database layer.
- Idempotency keys and retry/backoff semantics enforced in SQL.
- TypeScript + Python SDKs and workers for job execution.
- Operational tooling: doctor checks, impact map tooling, replay bundles, and smoke tests.

## Quick Start

### 1) Apply database migrations

```bash
# Supabase CLI
cd supabase
supabase db push

# OR standalone Postgres
psql -U postgres -d your_database -f supabase/migrations/001_jobforge_core.sql
```

### 2) Install dependencies

```bash
pnpm install
```

### 3) Run the TypeScript worker

```bash
SUPABASE_URL=your_supabase_url \
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
pnpm run worker:ts:dev
```

**Success signal:** the worker starts polling and logs job execution/heartbeat activity to stdout.

## Architecture Overview

- **supabase/**: database schema, RPCs, RLS policies, and isolation tests.
- **packages/shared/**: shared types, schemas, feature flags, and execution-plane contracts.
- **packages/sdk-ts/** + **packages/sdk-py/**: client libraries.
- **services/worker-ts/** + **services/worker-py/**: worker implementations and job handlers.
- **scripts/**: CLI utilities (doctor, impact, replay, smoke tests).

## Extending the Project

- **Add a job type**: create a new handler in `services/worker-ts/src/handlers` (or the Python worker), then register it in the worker registry.
- **Extend schemas**: update types and validation in `packages/shared/src` to keep SDKs and workers consistent.
- **Add tooling**: add scripts under `scripts/` and wire them into `pnpm run docs:verify` if they are referenced in docs.

Common mistakes to avoid:

- Bypassing RPC functions (mutations must go through RPC to keep RLS and state transitions correct).
- Using the Supabase service role key in a client/browser context.

## Failure & Degradation Model

- Jobs are retried with exponential backoff until max attempts, then marked `dead`.
- Idempotent enqueues return the original job for the same `(tenant_id, type, idempotency_key)`.
- Worker crashes do not lose jobs; unacknowledged jobs return to the queue.

See [supabase/README.md](supabase/README.md) for status transitions and retry semantics.

## Security & Safety Considerations

- Tenant isolation is enforced with RLS policies at the database layer.
- RPC functions are the only supported mutation path.
- HTTP connector handlers include SSRF protection and allowlist support.

See [docs/SECURITY.md](docs/SECURITY.md) for the full model.

## Contributing

We welcome:

- Docs improvements and examples
- New job handlers or worker improvements
- SDK enhancements and bug fixes

Start with [CONTRIBUTING.md](CONTRIBUTING.md) for setup, quality gates, and first-time contributor guidance.

## License & Governance

- **License**: MIT (see [LICENSE](LICENSE)).
- **Governance**: See [GOVERNANCE.md](GOVERNANCE.md) for decision-making and maintainer roles.
