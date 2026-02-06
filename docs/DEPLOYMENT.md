# JobForge Deployment Guide

This guide covers local development and production deployment steps.

## Prerequisites

- Node.js **20+** (see `.nvmrc`)
- pnpm **8+**
- Python **3.11+** for Python SDK + workers
- Supabase/Postgres (local or hosted)

## Environment Variables

**Required:**

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL` (for Prisma tooling in `packages/database`)

Optional:

- `JOBFORGE_HEALTH_RATE_LIMIT`
- `JOBFORGE_HEALTH_RATE_WINDOW_MS`

## Local Development

```bash
pnpm install

# Web app
cd apps/web
pnpm dev

# TypeScript worker
cd services/worker-ts
pnpm dev

# Python worker
cd services/worker-py
pip install -e ".[dev]"
python -m jobforge_worker.cli run
```

## Production Build

```bash
pnpm install --frozen-lockfile
pnpm run build
```

## Health Check

- Endpoint: `GET /api/health`
- Returns status, timestamp, and correlation ID.
- Rate-limited in-memory by client IP.

## Verification

```bash
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm jobforge:doctor
```

## E2E Smoke Suite

```bash
pnpm run e2e:smoke
```
