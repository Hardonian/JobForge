# JobForge

Language-Agnostic Job Orchestrator for Postgres

A Postgres-native job framework with language-agnostic workers (Python, Node, Go). Idempotency, retries, backoff built-in. RPC-first, RLS-aware. No Redis, no Kafka—boringly correct OSS.

Perfect for Supabase users tired of ad-hoc queues.

## Features

- **Postgres-Native Queue** - Job queue lives in Postgres, no external dependencies
- **Language-Agnostic Workers** - Python, Node.js, Go workers (Python implemented)
- **Idempotent Handlers** - Safe to retry, safe to run multiple times
- **Automatic Retries** - Configurable retry policy with exponential backoff
- **Distributed Locking** - Multiple workers, no race conditions
- **Correlation ID Tracking** - End-to-end request tracing
- **RPC-Based Writes** - All mutations through API for consistency
- **Production-Hardened** - Error envelopes, resilient fetch, connection pooling

## Quick Start

### Python Worker

```bash
cd packages/python-worker
pip install -r requirements.txt

# Configure environment
cp examples/.env.example .env
# Edit .env with your DATABASE_URL, WORKER_ID, API_BASE_URL

# Run example worker
python examples/example_worker.py
```

See [Python Worker Documentation](packages/python-worker/README.md) for details.

## Monorepo Structure

```
jobforge/
├── apps/
│   └── web/              # Next.js web UI
├── packages/
│   ├── database/         # Prisma schema & client
│   ├── errors/           # Error handling & correlation IDs
│   ├── fetch/            # Resilient HTTP client
│   ├── python-worker/    # Python worker framework ⭐
│   ├── design-system/    # Design tokens
│   ├── ui/               # React components
│   └── config/           # Shared ESLint config
```

## Development

```bash
# Install dependencies
pnpm install

# Run all checks
pnpm run verify:fast  # format + lint + typecheck
pnpm run verify:full  # verify:fast + test + build

# Run individual checks
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
```

## License

MIT
