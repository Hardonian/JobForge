# JobForge Reality Map

**Generated:** 2025-02-14

## 1) Stack + Entrypoints

### Runtime & Tooling

- **Node.js** (Next.js 14, Vite/Vitest, Turbo)
- **Package Manager:** pnpm workspaces
- **TypeScript** across apps/services/packages
- **Python** for worker + SDK packages
- **Database:** PostgreSQL (Supabase) with RPC + RLS policies

### Entrypoints

- **Web Dashboard:** `apps/web` (Next.js App Router)
  - Homepage: `apps/web/src/app/page.tsx`
  - Health endpoint: `apps/web/src/app/api/health/route.ts`
- **TypeScript Worker:** `services/worker-ts` (CLI + handlers)
- **Python Worker:** `services/worker-py` (CLI + handlers)
- **SDKs:** `packages/sdk-ts`, `packages/sdk-py`
- **Contracts:** `packages/shared` + `packages/contracts`
- **Database:** `supabase/migrations/` + RPC layer

## 2) User-Facing Flows

- **Web landing page** (static marketing / info)
- **Health check** (`/api/health`) for liveness + rate limit signals
- **Webhook delivery** (worker handlers) for outbound notifications
- **Job routing** via SDKs → Supabase RPC functions

## 3) Critical APIs / Webhooks

- **RPC:** `jobforge_enqueue_job`, `jobforge_claim_jobs`, `jobforge_complete_job`, etc.
- **Webhook delivery (TS/Python workers):**
  - Validates payloads (Zod / Pydantic)
  - HMAC signing when `secret_ref` is provided
  - SSRF protection on outbound target URLs

## 4) Auth / Tenant Boundaries

- **Primary boundary:** Postgres RLS (tenant-scoped tables)
- **Workers:** expected to use service role key server-side only
- **Middleware:** correlation ID propagation for web requests

## 5) Observability & Resilience

- **Structured logging** in API health endpoint
- **Correlation IDs** injected via Next.js middleware
- **Error boundaries** (`error.tsx`, `not-found.tsx`) for UI degradation
- **Worker logs** with job context

## 6) Baseline Checks (Pre-fix)

| Command              | Result (Initial)                                     |
| -------------------- | ---------------------------------------------------- |
| `pnpm install`       | ✅                                                   |
| `pnpm run lint`      | ❌ (worker-ts eslint + python lint failures)         |
| `pnpm run typecheck` | ❌ (workspace module resolution in @jobforge/client) |
| `pnpm test`          | ❌ (Prisma generate missing + missing python tests)  |
| `pnpm run build`     | ❌ (contracts missing Node types)                    |
| `pnpm run e2e:smoke` | ❌ (`tsx` not installed)                             |

## 7) Hardening Targets (Implemented)

- ✅ Error UI (`error.tsx`, `not-found.tsx`)
- ✅ Health endpoint with rate limiting
- ✅ SSRF protection for webhook delivery
- ✅ E2E smoke suite hardened for dry-run + CI execution
- ✅ CI gates updated to run real checks

## 8) Remaining Risk Areas

- **Supabase integration**: requires real credentials for full end-to-end validation
- **Connector allowlists**: enforced per-connector configuration (recommended)
- **Secrets**: must be provided via env vars or secret store (no plaintext in DB)
