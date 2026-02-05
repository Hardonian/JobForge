# AGENTS.md — Operating Manual for AI Agents

**Version:** 1.0.0  
**Last Updated:** 2025-02-04  
**Purpose:** This document defines how AI agents should work in the JobForge repository. All agents must read and follow these guidelines before making changes.

---

## 1) Purpose

**What this repo is:**

- **JobForge** is an agent router for multi-tenant SaaS that routes autonomous agent workloads through PostgreSQL (Supabase)
- No Redis, no Kafka, no message bus—just SQL, RPC, and determinism
- Provides job queue, result storage, attempt tracking, and retry with exponential backoff
- Supports TypeScript and Python workers via claim-based polling

**Who it's for:**

- Engineers building AI agent systems that need reliable job execution
- Multi-tenant SaaS applications requiring tenant-isolated job processing
- Teams needing deterministic, traceable agent work

**What "done" means:**

- All code passes lint, typecheck, and build verification (`pnpm verify:fast`)
- All tests pass (`pnpm test`)
- Contract tests validate runner behavior (`pnpm run contract-tests`)
- CLI commands work (`pnpm jobforge:doctor`)
- No hard-500 routes; graceful fallbacks for all error conditions
- No secrets in code; all env vars validated without exposure

---

## 2) Repo Map (Practical)

```
jobforge/
├── apps/
│   └── web/                    # Next.js 14 web application (dashboard)
│
├── packages/
│   ├── sdk-ts/                 # TypeScript SDK (server-only)
│   ├── sdk-py/                 # Python SDK (pyproject.toml)
│   ├── shared/                 # Shared types, contracts, golden tests
│   ├── ui/                     # React UI components
│   ├── design-system/          # Design tokens, theme configuration
│   ├── errors/                 # Error handling utilities
│   ├── fetch/                  # HTTP client wrapper
│   ├── database/               # Database utilities and tests
│   ├── adapters/               # Connector implementations
│   │   ├── aias/               # AI agent routing
│   │   ├── keys/               # API key management
│   │   ├── readylayer/         # CDN integration
│   │   └── settler/            # Contract lifecycle management
│   ├── contracts/              # Contract definitions
│   ├── autopilot-contracts/    # Autopilot runner contracts
│   ├── autopilot-compat/       # Autopilot compatibility layer
│   └── typescript-config/      # Shared TS config
│
├── services/
│   ├── worker-ts/              # TypeScript worker service
│   └── worker-py/              # Python worker service
│
├── supabase/
│   ├── migrations/             # SQL schema and RPC functions
│   └── tests/                  # RLS isolation tests
│
├── scripts/                    # CLI scripts and tooling
│   ├── jobforge-doctor.ts      # Health check diagnostic
│   ├── jobforge-impact.ts      # Impact analysis
│   ├── jobforge-daily.ts       # Daily maintenance
│   └── smoke-test-*.ts         # Smoke test runners
│
├── examples/
│   └── integrations/           # Working integration examples
│
└── docs/                       # Architecture and runbook docs
```

**Source of Truth Locations:**

- **Content/Copy:** Not centralized; spread across component files in `apps/web/` and `packages/ui/`
- **Components:** `packages/ui/src/` and `apps/web/components/`
- **Config:** Root `package.json`, `turbo.json`, `tsconfig.json`, `.eslintrc.json`
- **Tokens/Styles:** `packages/design-system/src/` (minimal; not detected in detail)
- **Tests:** `packages/*/test/` or `packages/*/src/**/*.test.ts`
- **Contracts:** `packages/shared/src/runner-contract-enforcement.ts`
- **Database Schema:** `supabase/migrations/`

---

## 3) Golden Rules (Invariants)

### Security + Privacy

- **NO SECRETS in code** — env vars only via `.env.*.local` files
- **NO HARDCODED KEYS** — always use environment configuration
- **RLS (Row Level Security)** — database queries must respect tenant boundaries
- **Least Privilege** — workers only see jobs for accessible tenants
- **SSRF Protection** — validate all external URLs before fetching

### Data Integrity

- **NO FAKE DATA/CLAIMS** — never invent metrics, customers, or functionality
- **Idempotent Enqueue** — same `(tenant, type, key)` = same job_id
- **Deterministic Traces** — every execution produces input snapshot + decision trace + output artifact
- **No Hard-500 Routes** — graceful fallbacks with proper error handling

### Code Quality

- **Minimal Diffs** — avoid refactors unless required for the task
- **Deterministic Builds** — keep CI green; never break the build
- **No Dead Imports** — clean up unused dependencies
- **No Unused Files** — don't introduce files that aren't referenced
- **No Token Drift** — maintain design system consistency

---

## 4) Agent Workflow (How to Work Here)

### Phase 1: Discover

1. Read relevant docs: `README.md`, `docs/ARCHITECTURE.md`, `docs/RUNBOOK.md`
2. Understand the change scope: which packages/apps/services are affected?
3. Check existing tests: how is this area tested today?
4. Run `pnpm jobforge:doctor` to verify environment

### Phase 2: Diagnose

1. Reproduce the issue or understand the requirement fully
2. Gather evidence: logs, error messages, stack traces
3. Identify root cause before proposing fixes
4. File references: note specific files and line numbers

### Phase 3: Implement

1. **Smallest Safe Patch** — make the minimal change that solves the problem
2. **Reversible Changes** — ensure changes can be rolled back if needed
3. **Follow Existing Patterns** — match code style and architecture
4. **Update Tests** — add or modify tests for the change

### Phase 4: Verify

1. Run `pnpm run verify:fast` (format check, lint, typecheck)
2. Run `pnpm test` (unit tests)
3. Run `pnpm run contract-tests` (if modifying runners)
4. Run `pnpm jobforge:doctor` (health check)
5. Manual smoke test if needed

### Phase 5: Report

1. Document what was changed and why
2. Include verification steps in PR description
3. Reference any related issues or docs

---

## 5) Command Cookbook (Actual Commands)

### Install

```bash
pnpm install
```

### Development

```bash
pnpm dev                    # Start all dev servers (turbo)
# OR
cd apps/web && pnpm dev     # Start web app only
cd services/worker-ts && pnpm dev  # Start TypeScript worker
cd services/worker-py && python -m jobforge_worker.cli run  # Start Python worker
```

### Code Quality

```bash
pnpm run lint               # ESLint across all packages
pnpm run typecheck          # TypeScript type checking
pnpm run format             # Format with Prettier
pnpm run format:check       # Check formatting without fixing
```

### Testing

```bash
pnpm test                   # Run all unit tests
pnpm run test:observability # Run observability tests
pnpm run contract-tests     # Run runner contract tests
pnpm run e2e:smoke          # Run E2E smoke tests
```

### Build

```bash
pnpm run build              # Build all packages
```

### Verification

```bash
pnpm run verify:fast        # format:check + lint + typecheck
pnpm run verify:full        # verify:fast + test + build
```

### CLI Tools

```bash
pnpm jobforge:doctor                    # Health check diagnostic
pnpm jobforge:impact:show --run <id>    # View execution impact
pnpm jobforge:impact:export             # Export impact data
pnpm jobforge:daily                     # Daily maintenance tasks
```

### Database (Supabase)

```bash
cd supabase
supabase db push                    # Push migrations
supabase db reset                   # Reset local database
```

### Python (services/worker-py, packages/sdk-py)

```bash
# Setup
cd services/worker-py
pip install -r requirements.txt     # Assumed; confirm in service dir

# Development
python -m jobforge_worker.cli run   # Start worker
ruff check .                        # Lint
mypy .                              # Type check
pytest                              # Run tests
```

---

## 6) Change Safety Checklist (Required Before Commit)

**Must pass before any commit:**

- [ ] `pnpm run format:check` — formatting is correct
- [ ] `pnpm run lint` — no lint errors
- [ ] `pnpm run typecheck` — TypeScript compiles
- [ ] `pnpm run build` — build succeeds
- [ ] `pnpm test` — all tests pass
- [ ] No dead imports — clean up unused imports
- [ ] No unused files — don't commit unreferenced files
- [ ] No secrets — scan for API keys, passwords, tokens
- [ ] No token drift — design system tokens remain consistent
- [ ] No hard-500 routes — error handling in place

**For runner changes, also:**

- [ ] `pnpm run contract-tests` — contract tests pass
- [ ] Golden tests updated if behavior changes
- [ ] Registry updated if adding new handlers

---

## 7) Code Standards (Repo-Specific)

### TypeScript/ESLint

- **ES2022 target** — modern JavaScript features
- **Strict TypeScript** — no implicit any
- **Semicolons:** Disabled (see `.prettierrc.json`)
- **Single quotes:** Required
- **Tab width:** 2 spaces
- **Trailing commas:** ES5 compatible
- **Print width:** 100 characters
- **Arrow parens:** Always

### Error Handling

- Use `@jobforge/errors` package for consistent error types
- Always include trace_id in worker execution context
- Return structured errors, not thrown exceptions in RPC boundaries

### Environment Variables

- Located in `.env.example` files in each service/package
- Validated using Zod schemas (see `packages/*/src/config.ts` patterns)
- **Never commit `.env.local` or `.env.*.local` files**
- Required vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

### Component Patterns

- React 18+ with TypeScript
- Next.js 14 App Router pattern
- UI components in `packages/ui/`
- Use workspace dependencies: `"@jobforge/ui": "workspace:*"`

### Testing

- **Vitest** for unit tests (detected in packages/shared, services/worker-ts, etc.)
- **pytest** for Python tests
- Contract tests validate runner behavior determinism
- E2E smoke tests in `scripts/e2e-smoke-runner.ts`

---

## 8) PR / Commit Standards

### Branch Naming

- Feature: `feature/description`
- Fix: `fix/description`
- Docs: `docs/description`
- Chore: `chore/description`
- Example: `chore/agents-and-skills`

### Commit Message Style

- Format: `type(scope): description`
- Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`
- Example: `docs: add AGENTS and SKILLS operating manuals`
- Keep first line under 72 characters
- Use body for detailed explanation if needed

### PR Description Requirements

1. **Root Cause** — what problem does this solve?
2. **Changes Made** — bullet list of files/directories modified
3. **Verification Steps** — how to test/reproduce
4. **Breaking Changes** — any API or behavior changes
5. **Related Issues** — issue numbers or docs references

### CI Requirements

- All quality gates must pass (format, lint, typecheck, build, test)
- Contract tests must pass for runner changes
- Docs verification must pass (`pnpm run docs:verify`)
- Security scan (informational, doesn't block)

---

## 9) Roadmap Hooks (Agent-Ready Backlog)

### Immediate (Next 30 Days)

1. **Design System Token Centralization** — consolidate tokens from scattered locations into `packages/design-system/`
2. **Import Boundary Audit** — verify all workspace imports use correct package boundaries
3. **Python Worker Test Coverage** — add pytest suite to `services/worker-py/`
4. **Database Migration Verification** — add CI step to validate migration order and idempotency
5. **Error Boundary Implementation** — add React error boundaries to `apps/web/` routes

### Short-term (30-60 Days)

6. **CI Enforcement** — add stricter gates for contract test coverage
7. **Documentation Consolidation** — merge duplicate docs (AUDIT_NOTES.md, REALITY_MAP.md into ARCHITECTURE.md)
8. **Web App Route Smoke Tests** — add Playwright or similar for critical user flows
9. **Adapter Test Suite** — contract tests for all adapters in `packages/adapters/`
10. **Observability Dashboard** — build UI for job metrics in `apps/web/`

### Medium-term (60-90 Days)

11. **SDK Documentation Site** — generated docs from TypeScript types
12. **Benchmark Suite** — performance tests for job throughput
13. **Multi-Region Deployment Guide** — docs for geo-distributed setup
14. **Worker Auto-Scaling** — Kubernetes HPA or similar configuration
15. **Schema Versioning** — migration rollback strategy and versioning scheme

---

## Appendix: Quick Reference

**Important Files to Read:**

- `README.md` — Project overview and quick start
- `docs/ARCHITECTURE.md` — System design, RPC definitions
- `docs/RUNBOOK.md` — Operations and monitoring
- `packages/shared/src/runner-contract-enforcement.ts` — Contract schema
- `turbo.json` — Build pipeline configuration

**Contact Points:**

- Issues: GitHub Issues
- Security: See `SECURITY.md`
- Contributing: See `CONTRIBUTING.md`

**Not Detected in Repo (Needs Confirmation):**

- Docker setup (no Dockerfile found at root)
- Kubernetes manifests (none detected)
- Terraform/infra-as-code (none detected)
- Storybook for UI components (not detected)
- Specific deployment targets beyond CI

---

_This document is a living guide. Update it as the repo evolves._
