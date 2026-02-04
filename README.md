# JobForge

**Agent Router for Multi-Tenant SaaS**

JobForge routes autonomous agent workloads through Postgres. No Redis, no Kafka, no message bus—just SQL, RPC, and determinism.

Built for engineers who want agents that actually complete work, not just start it.

## What It Does

JobForge is an **agent router**: it takes jobs from AI agents, SaaS webhooks, or internal services and guarantees they run exactly once, in order, with full observability.

```
┌──────────────────────────────────────────────────────────────┐
│  Agent / Webhook / Service                                    │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTP / RPC
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  PostgreSQL/Supabase                                         │
│  ┌─────────────────────┐  ┌──────────────────────────────┐    │
│  │ jobforge_jobs       │  │ RPC Functions              │    │
│  │ - job queue         │  │ - enqueue (idempotent)     │    │
│  │ - result storage    │  │ - claim (SKIP LOCKED)      │    │
│  │ - attempt tracking  │  │ - complete / fail          │    │
│  └─────────────────────┘  └──────────────────────────────┘    │
└──────────────────┬───────────────────────────────────────────┘
                   │ Poll via RPC
                   ▼
┌──────────────────────────────────────────────────────────────┐
│  Workers (TypeScript / Python)                              │
│  - Poll for jobs via claim()                                 │
│  - Execute with trace_id correlation                         │
│  - Return results or retry with backoff                      │
└──────────────────────────────────────────────────────────────┘
```

**Key Design Decisions:**

- **Postgres as Router**: Job state, ordering, and durability are Postgres's problem
- **Idempotent Enqueue**: Same `(tenant, type, key)` = same job_id, no duplicates
- **RLS Isolation**: Workers only see jobs for tenants they have access to
- **Deterministic Traces**: Every execution produces input snapshot + decision trace + output artifact
- **No External Dependencies**: Works with stock Postgres 14+, no extensions needed

## Quick Start

### 1. Database Setup

```bash
# Using Supabase CLI
cd supabase
supabase db push

# Or plain psql
psql $DATABASE_URL -f supabase/migrations/001_jobforge_core.sql
```

### 2. Enqueue Work

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const client = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Route an AI agent task
const job = await client.enqueueJob({
  tenant_id: 'tenant-uuid',
  type: 'autopilot.ops.scan',
  payload: {
    target: 'production',
    scan_type: 'cost_optimization',
  },
  idempotency_key: 'daily-cost-scan-2024-01-15',
})

console.log(`Routed: ${job.id}`)
```

### 3. Run Worker

```bash
# TypeScript Worker
cd services/worker-ts
cp .env.example .env
# Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
pnpm install
pnpm start

# Python Worker
cd services/worker-py
cp .env.example .env
pip install -r requirements.txt
python -m jobforge_worker.cli run
```

## For Contributors

### Add a Runner

Runners are job processors grouped by domain:

1. **Create runner config** in `packages/shared/src/runner-contract-enforcement.ts`:

```typescript
const myRunner: RunnerConfig = {
  runner_id: 'my-custom-runner',
  runner_type: 'ops',
  version: '1.0.0',
  methods: {
    execute: true,
    validate: true,
    health: true,
    trace: true,
  },
  determinism: {
    input_snapshot: true,
    decision_trace: true,
    output_artifact: true,
    replayable: true,
  },
  // ... see runner-contract-enforcement.ts for full schema
}
```

2. **Add handler** in `services/worker-ts/src/handlers/my-domain/`:

```typescript
export const myJobHandler: JobHandler = async (payload, context) => {
  // 1. Validate input (schema already checked, but validate business rules)
  // 2. Execute with trace logging
  // 3. Return deterministic output
  return { success: true, result: 'processed' }
}
```

3. **Register handler** in `services/worker-ts/src/lib/registry.ts`:

```typescript
registerHandler('my.job.type', myJobHandler)
```

4. **Add contract tests** in `packages/shared/test/contract-tests.ts`:

```typescript
// Golden test: input → expected output
GOLDEN_CONTRACT_TESTS.ops.push({
  name: 'my_job_valid_input',
  input: {
    /* ... */
  },
  expected_output: { success: true },
  expected_trace_keys: ['timestamp', 'runner_id', 'decision'],
  expected_artifact_keys: ['result'],
  deterministic: true,
})
```

### Add a Connector

Connectors define integration capabilities:

1. **Create metadata** in `connectors/my-connector/metadata.json`:

```json
{
  "connector_id": "my.api",
  "version": "1.0.0",
  "status": "stable",
  "maturity": "production",
  "supported_job_types": ["my.api.call"],
  "capabilities": {
    "bidirectional": false,
    "streaming": false,
    "batch": true,
    "real_time": false,
    "webhook": true,
    "polling": true
  },
  "auth": {
    "required": true,
    "methods": ["api_key"],
    "credentials_storage": "env"
  },
  "rate_limits": {
    "requests_per_second": 10,
    "burst_size": 20,
    "quota_period": "minute",
    "retry_after_header": true
  },
  "failure_modes": [
    {
      "type": "rate_limit_exceeded",
      "retryable": true,
      "retry_strategy": "exponential_backoff",
      "max_retries": 3,
      "fallback_behavior": "queue",
      "circuit_breaker": true
    }
  ],
  "observability": {
    "metrics": true,
    "logs": true,
    "traces": true,
    "health_check": true
  }
}
```

2. **Run registry validation**:

```bash
pnpm exec tsx scripts/validate-connector.ts connectors/my-connector
```

3. **Generate registry files**:

```bash
pnpm exec tsx scripts/generate-registry.ts --output docs/connectors/
```

## Integration Examples

See `examples/integrations/` for working code:

- **ReadyLayer** (`readylayer-example.ts`) - CDN cache warming, asset optimization
- **Settler** (`settler-example.ts`) - Contract lifecycle management
- **AIAS** (`aias-example.ts`) - AI agent task routing
- **TruthCore** (`truthcore-example.ts`) - Data verification pipelines

## Architecture

JobForge separates concerns into layers:

**Router Layer (Postgres)**

- `jobforge_jobs` - Queue with SKIP LOCKED claim
- `jobforge_job_results` - Immutable execution results
- `jobforge_triggers` - Event-to-job routing
- RLS policies enforce tenant boundaries

**Runner Layer (Workers)**

- Poll via `claim_jobs()` RPC
- Execute with `trace_id` correlation
- Retry with exponential backoff
- Dead-letter after max attempts

**Contract Layer (Validation)**

- Runner schemas enforce determinism
- Golden tests validate behavior
- Registry tracks connector metadata
- CI blocks merge on contract drift

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for RPC definitions, RLS policies, and concurrency model.

## Monorepo Structure

```
jobforge/
├── supabase/
│   ├── migrations/          # SQL schema and RPC functions
│   └── tests/               # RLS isolation tests
├── packages/
│   ├── sdk-ts/              # TypeScript client SDK
│   ├── sdk-py/              # Python client SDK
│   ├── shared/              # Contract enforcement, validation
│   │   ├── src/
│   │   │   ├── runner-contract-enforcement.ts
│   │   │   ├── connector-registry.ts
│   │   │   └── invocation-determinism.ts
│   │   └── test/
│   │       └── contract-tests.ts       # Golden tests
│   └── adapters/
│       ├── readylayer/       # CDN integration
│       ├── settler/          # Contract management
│       ├── aias/             # AI agent routing
│       └── keys/             # API key management
├── services/
│   ├── worker-ts/           # TypeScript worker
│   └── worker-py/           # Python worker
├── examples/
│   └── integrations/        # Working integration examples
└── docs/
    ├── ARCHITECTURE.md      # Design docs
    ├── RUNBOOK.md           # Ops guide
    └── integrations/        # Adapter-specific guides
```

## CLI

| Command                                | Purpose                   |
| -------------------------------------- | ------------------------- |
| `pnpm jobforge:doctor`                 | Health checks             |
| `pnpm jobforge:impact:show --run <id>` | View execution impact     |
| `pnpm run contract-tests`              | Validate runner contracts |
| `pnpm run test`                        | Unit tests                |
| `pnpm run verify:fast`                 | Lint + typecheck + build  |

See [docs/cli.md](docs/cli.md) for full reference.

## Development

```bash
# Setup
pnpm install

# Verify (fast)
pnpm run verify:fast

# Full verification (includes tests)
pnpm run verify:full

# Run specific checks
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design, RPC definitions
- [Runbook](docs/RUNBOOK.md) - Operations, monitoring
- [Security](docs/SECURITY.md) - RLS, SSRF protection, signing
- [Integration Guides](docs/integrations/) - Adapter usage

## License

MIT - See [LICENSE](LICENSE)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

---

**JobForge** - Route agent work through Postgres. No surprises, no lost jobs.
