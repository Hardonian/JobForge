# JobForge

**Production-Grade, Postgres-Native Job Queue**

A Postgres-native job queue/workhorse designed as a drop-in module for multi-tenant SaaS applications. Built on Supabase/Postgres with RPC, RLS, idempotency, retries, and concurrency-safe operations.

Perfect for Supabase users who need reliable background job processing without Redis or Kafka.

## Features

- **Postgres is the Truth Layer** - All job state in Postgres with RPC-based mutations
- **Multi-Tenant Isolation** - Strict tenant isolation via Row Level Security (RLS)
- **Concurrency-Safe** - `FOR UPDATE SKIP LOCKED` prevents race conditions
- **Idempotent by Default** - Deduplication via `(tenant_id, type, idempotency_key)`
- **Automatic Retries** - Exponential backoff (1s → 2s → 4s → ... → 3600s max)
- **Dead Letter Queue** - Failed jobs move to `dead` status after max attempts
- **Observable** - Structured logs, correlation IDs, heartbeat tracking
- **Language-Agnostic** - TypeScript and Python workers + SDKs included
- **Built-in Connectors** - HTTP requests, webhooks, reports, and more

## Quick Start

### 1. Apply Database Migrations

```bash
# Via Supabase CLI
cd supabase
supabase db push

# OR via psql
psql -U postgres -d your_database -f supabase/migrations/001_jobforge_core.sql
```

See [Database Schema Docs](supabase/README.md) for details.

### 2. Enqueue a Job (TypeScript)

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const client = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Enqueue HTTP request job
const job = await client.enqueueJob({
  tenant_id: 'your-tenant-uuid',
  type: 'connector.http.request',
  payload: {
    url: 'https://api.example.com/webhook',
    method: 'POST',
    body: { message: 'Hello from JobForge!' },
  },
  idempotency_key: 'webhook-delivery-123',
})

console.log(`Job enqueued: ${job.id}`)
```

### 3. Run Worker

**TypeScript Worker:**

```bash
cd services/worker-ts
cp .env.example .env
# Edit .env with your Supabase credentials

pnpm install
pnpm run dev    # Development mode
pnpm start      # Production mode
```

**Python Worker:**

```bash
cd services/worker-py
cp .env.example .env
# Edit .env with your Supabase credentials

pip install -r requirements.txt
python -m jobforge_worker.cli run    # Loop mode
python -m jobforge_worker.cli once   # Run once
```

See [Workers Documentation](docs/workers.md) for details.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PostgreSQL/Supabase                     │
│  ┌────────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ jobforge_jobs  │  │ RPC Functions│  │  RLS Policies   │ │
│  │ (job queue)    │  │ - enqueue    │  │ (tenant guard)  │ │
│  │                │  │ - claim      │  │                 │ │
│  │ + results      │  │ - complete   │  │                 │ │
│  │ + attempts     │  │ - heartbeat  │  │                 │ │
│  └────────────────┘  └──────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ RPC calls
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    ┌────▼─────┐         ┌────▼─────┐       ┌─────▼────┐
    │ TS SDK   │         │ Py SDK   │       │ Next.js  │
    │ (client) │         │ (client) │       │ (enqueue)│
    └──────────┘         └──────────┘       └──────────┘
         │                    │
    ┌────▼─────┐         ┌────▼─────┐
    │ TS Worker│         │ Py Worker│
    │ (process)│         │ (process)│
    └──────────┘         └──────────┘
```

- **Database Layer**: Postgres tables + RPC functions + RLS policies
- **SDK Layer**: Server-only clients for enqueuing and querying jobs
- **Worker Layer**: Poll and process jobs with registered handlers
- **Connector Layer**: Built-in handlers (HTTP, webhook, report, etc.)

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for in-depth design.

## Monorepo Structure

```
jobforge/
├── supabase/
│   ├── migrations/          # SQL migrations
│   ├── sql/                 # Helper scripts
│   ├── tests/               # RLS isolation tests
│   └── README.md
├── packages/
│   ├── sdk-ts/              # TypeScript SDK
│   ├── sdk-py/              # Python SDK
│   ├── shared/              # Shared types & constants
│   └── adapters/            # Integration adapters
│       ├── settler/         # Contract management
│       ├── readylayer/      # CDN/asset delivery
│       ├── aias/            # AI agent system
│       └── keys/            # API key management
├── services/
│   ├── worker-ts/           # TypeScript worker
│   └── worker-py/           # Python worker
├── docs/
│   ├── ARCHITECTURE.md      # System design
│   ├── RUNBOOK.md           # Operations guide
│   ├── SECURITY.md          # Security model
│   └── integrations/        # Product-specific guides
└── apps/
    └── demo-next/           # Demo Next.js app
```

## Built-in Connectors

JobForge includes production-ready connectors:

- **connector.http.request** - HTTP requests with SSRF protection
- **connector.webhook.deliver** - Webhook delivery with HMAC signing
- **connector.report.generate** - Report generation (JSON/HTML/CSV)

See [Connectors Documentation](docs/connectors.md) for usage.

## Autopilot Job Templates (Beta)

JobForge includes runnerless autopilot job templates for common operations:

**Ops Jobs:**

- `autopilot.ops.scan` - Infrastructure health/security/cost scanning
- `autopilot.ops.diagnose` - Root cause analysis
- `autopilot.ops.recommend` - Generate optimization recommendations
- `autopilot.ops.apply` - Apply recommendations (action job - requires policy token)

**Support Jobs:**

- `autopilot.support.triage` - Ticket classification and routing
- `autopilot.support.draft_reply` - Draft support responses
- `autopilot.support.propose_kb_patch` - Draft KB article updates

**Growth Jobs:**

- `autopilot.growth.seo_scan` - SEO analysis and recommendations
- `autopilot.growth.experiment_propose` - A/B test recommendations
- `autopilot.growth.content_draft` - Marketing content generation

**FinOps Jobs:**

- `autopilot.finops.reconcile` - Billing reconciliation
- `autopilot.finops.anomaly_scan` - Cost anomaly detection
- `autopilot.finops.churn_risk_report` - Customer churn risk analysis

**Bundle Executor:**

- `jobforge.autopilot.execute_request_bundle` - Execute multiple jobs atomically

### Enabling Autopilot Jobs

```bash
# Enable autopilot jobs (required for all autopilot job types)
JOBFORGE_AUTOPILOT_JOBS_ENABLED=1

# Enable action jobs (required for autopilot.ops.apply)
JOBFORGE_ACTION_JOBS_ENABLED=1
JOBFORGE_POLICY_TOKEN_SECRET=your-secret-here
```

See [AUTOPILOT_IMPLEMENTATION.md](AUTOPILOT_IMPLEMENTATION.md) for implementation details.

## Integration Adapters

Drop-in modules for common SaaS products:

- **@jobforge/adapter-settler** - Contract processing, notifications
- **@jobforge/adapter-readylayer** - Asset optimization, CDN purge
- **@jobforge/adapter-aias** - AI agent execution, knowledge indexing
- **@jobforge/adapter-keys** - API key usage aggregation, rotation

See [Integration Guides](docs/integrations/) for copy-paste examples.

## Development

```bash
# Install dependencies
pnpm install

# Run fast verification (lint + typecheck + build)
pnpm run verify:fast

# Run full verification (includes tests)
pnpm run verify:full

# Format code
pnpm run format

# Run specific checks
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

## Documentation

- [Database Schema](supabase/README.md) - Tables, RPC functions, RLS policies
- [Architecture](docs/ARCHITECTURE.md) - Concurrency model, idempotency, retries
- [Runbook](docs/RUNBOOK.md) - Operations, monitoring, troubleshooting
- [Security](docs/SECURITY.md) - SSRF protection, webhook signing, RLS
- [Integration Guides](docs/integrations/) - Product-specific examples

## License

MIT - See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

**JobForge** - Boring, correct, Postgres-native job processing.
