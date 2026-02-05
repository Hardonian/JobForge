# SKILLS.md — Capability Map + Future Work Guide

**Version:** 1.0.0  
**Last Updated:** 2025-02-04  
**Purpose:** Route tasks to the right agent/model/tooling based on current repo capabilities and known gaps.

---

## 1) How to Use This File

**One paragraph:** Use this to route tasks to the right agent/model/tooling. Each section identifies what exists, what's missing, and what risks to watch for. When picking up work, scan the **Known Risks** section for pitfalls that have already bitten this codebase, then match your task to the appropriate **Skill Lane** to find patterns and validation steps.

---

## 2) Current Capability Inventory (What Exists Today)

### UI/Frontend

| Capability            | Status          | Notes                          |
| --------------------- | --------------- | ------------------------------ |
| Next.js 14 App Router | ✅ Detected     | `apps/web/` uses Next.js 14    |
| React 18              | ✅ Detected     | Standard React with TypeScript |
| Tailwind CSS          | ✅ Detected     | Configured in `apps/web/`      |
| shadcn/ui             | ❌ Not detected | Not confirmed in repo          |
| Radix UI              | ❌ Not detected | Not confirmed in repo          |
| Error Boundaries      | ⚠️ Partial      | Needs audit in `apps/web/`     |

### Content System

| Capability         | Status          | Notes                                          |
| ------------------ | --------------- | ---------------------------------------------- |
| Copy location      | ⚠️ Scattered    | Spread across component files, not centralized |
| i18n framework     | ❌ Not detected | No evidence of localization setup              |
| Content management | ❌ Not detected | No CMS or content API found                    |

### Tooling

| Capability | Status          | Notes                            |
| ---------- | --------------- | -------------------------------- |
| ESLint     | ✅ Detected     | Configured in `.eslintrc.json`   |
| Prettier   | ✅ Detected     | Configured in `.prettierrc.json` |
| TypeScript | ✅ Detected     | Strict mode enabled              |
| Vitest     | ✅ Detected     | Used in multiple packages        |
| pytest     | ✅ Detected     | For Python packages              |
| ruff       | ✅ Detected     | Python linting configured        |
| mypy       | ✅ Detected     | Python type checking             |
| pnpm       | ✅ Detected     | Package manager + monorepo       |
| Turbo      | ✅ Detected     | Build orchestration              |
| Docker     | ❌ Not detected | No Dockerfile at root            |

### CI/CD

| Capability         | Status           | Notes                              |
| ------------------ | ---------------- | ---------------------------------- |
| GitHub Actions     | ✅ Detected      | `.github/workflows/ci.yml` present |
| Format check       | ✅ Enforced      | Blocks merge                       |
| Lint               | ✅ Enforced      | Blocks merge                       |
| Type check         | ✅ Enforced      | Blocks merge                       |
| Unit tests         | ✅ Enforced      | Blocks merge                       |
| Contract tests     | ✅ Enforced      | Blocks merge                       |
| Build verification | ✅ Enforced      | Blocks merge                       |
| Docs verification  | ✅ Enforced      | Blocks merge                       |
| Security scan      | ✅ Informational | Does not block merge               |

### Observability

| Capability    | Status          | Notes                             |
| ------------- | --------------- | --------------------------------- |
| Logging       | ✅ Detected     | Structured logging via packages   |
| Metrics       | ⚠️ Partial      | Via observability package         |
| Tracing       | ✅ Detected     | `trace_id` correlation throughout |
| Health checks | ✅ Detected     | `jobforge:doctor` CLI             |
| Dashboard     | ❌ Not detected | No UI dashboard confirmed         |

### Database

| Capability    | Status      | Notes                             |
| ------------- | ----------- | --------------------------------- |
| PostgreSQL    | ✅ Detected | Supabase migrations present       |
| RLS           | ✅ Detected | Row Level Security configured     |
| RPC Functions | ✅ Detected | `claim_jobs`, `enqueue_job`, etc. |
| Migrations    | ✅ Detected | In `supabase/migrations/`         |

### Workers

| Capability        | Status      | Notes                          |
| ----------------- | ----------- | ------------------------------ |
| TypeScript Worker | ✅ Detected | `services/worker-ts/`          |
| Python Worker     | ✅ Detected | `services/worker-py/`          |
| Job Handlers      | ✅ Detected | Registry pattern in worker-ts  |
| Contract Tests    | ✅ Detected | Golden tests in shared package |

---

## 3) Skill Lanes (What Kinds of Work Happen Here)

### Lane A: Product/UX Writing

**Scope:** Enterprise-safe copy, landing page content, dashboard labels
**Examples from repo:**

- Dashboard copy in `apps/web/app/page.tsx`
- CLI output messages in `scripts/jobforge-doctor.ts`
- Error messages in `packages/errors/src/`

**Patterns:**

- Consultancy tone: professional, confident, direct
- No exclamation marks, no fluff
- Action-oriented labels ("Deploy", "Monitor", "Validate")

### Lane B: UI System Work

**Scope:** Tokens, Tailwind config, accessibility, component variants
**Examples from repo:**

- Design tokens in `packages/design-system/src/`
- UI components in `packages/ui/src/`
- Tailwind config in `apps/web/tailwind.config.ts`

**Patterns:**

- Workspace dependency: `"@jobforge/ui": "workspace:*"`
- Use design system tokens over hardcoded values
- Prefer composition over inheritance

### Lane C: Frontend Engineering

**Scope:** Next.js routing, data fetching, error boundaries, forms
**Examples from repo:**

- Next.js 14 App Router in `apps/web/app/`
- Error handling with `@jobforge/errors`
- Server components for data fetching

**Patterns:**

- App Router pattern (pages in `app/` directory)
- Server components by default, client components when needed
- Error boundaries at route level

### Lane D: Integration Boundaries

**Scope:** SDK imports, shared packages, workspace aliasing
**Examples from repo:**

- SDK packages in `packages/sdk-ts/` and `packages/sdk-py/`
- Shared types in `packages/shared/`
- Adapters in `packages/adapters/`

**Patterns:**

- Always use workspace dependencies for internal packages
- Zod schemas for validation
- Export from index.ts for clean imports

### Lane E: Runner/Worker Development

**Scope:** Job handlers, contract tests, worker polling
**Examples from repo:**

- Handler registry in `services/worker-ts/src/lib/registry.ts`
- Contract tests in `packages/shared/test/contract-tests.ts`
- Runner contracts in `packages/shared/src/runner-contract-enforcement.ts`

**Patterns:**

- Handlers return deterministic outputs
- Always include trace_id in context
- Register in `registry.ts`

### Lane F: QA & Release

**Scope:** Smoke flows, CI gates, contract validation
**Examples from repo:**

- E2E smoke tests in `scripts/e2e-smoke-runner.ts`
- Contract test runner in `packages/shared/test/contract-test-runner.ts`
- CI workflow in `.github/workflows/ci.yml`

**Patterns:**

- Contract tests validate deterministic behavior
- Smoke tests verify critical paths
- All gates must pass before merge

---

## 4) "Which Agent for Which Task" Matrix

| Task Type                                     | Recommended Approach        | Validation                        |
| --------------------------------------------- | --------------------------- | --------------------------------- |
| **Copy hardening** (landing pages, dashboard) | LLM pass + human skim       | Consistency scan, link check      |
| **Token system changes**                      | Engineer agent              | Visual diff + lint/build          |
| **Component refactoring**                     | Engineer agent              | Unit tests + visual regression    |
| **New runner/handler**                        | Engineer agent              | Contract tests + golden tests     |
| **Database migration**                        | Engineer agent + DBA review | Migration dry-run + rollback test |
| **SDK changes**                               | Engineer agent              | Integration tests + typecheck     |
| **Docs updates**                              | LLM pass                    | Docs verify script                |
| **CI/CD changes**                             | Engineer agent              | Test on feature branch            |
| **Security patches**                          | Security-focused agent      | Security scan + review            |
| **Performance optimization**                  | Engineer agent              | Benchmark before/after            |

---

## 5) Known Risks & Pitfalls (Observed)

### Risk 1: Missing Module Imports

**Symptom:** Build fails with "Cannot find module" errors
**Likely Cause:** Workspace dependency not declared or wrong package name
**Diagnosis:**

```bash
pnpm run build  # Will fail on missing imports
grep -r "from '@jobforge/" --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

**Fix:** Add to `package.json` dependencies: `"@jobforge/package": "workspace:*"`

### Risk 2: Inconsistent Tokens

**Symptom:** Visual inconsistency, wrong colors/spacing
**Likely Cause:** Hardcoded values instead of design system tokens
**Diagnosis:**

```bash
grep -r "#" packages/ui/src --include="*.tsx" | grep -E "#[0-9a-fA-F]{3,6}"
grep -r "text-\\[" packages/ui/src --include="*.tsx"  # Hardcoded Tailwind values
```

**Fix:** Use tokens from `@jobforge/design-system`

### Risk 3: Contract Drift

**Symptom:** Contract tests fail after runner changes
**Likely Cause:** Changed output shape without updating golden tests
**Diagnosis:**

```bash
pnpm run contract-tests  # Will show which tests fail
```

**Fix:** Update `packages/shared/test/contract-tests.ts` with new expected outputs

### Risk 4: RLS Policy Gaps

**Symptom:** Workers see jobs from wrong tenants
**Likely Cause:** Missing or incorrect RLS policies in migrations
**Diagnosis:**

```bash
cd supabase && supabase db test  # If test suite exists
```

**Fix:** Review migrations in `supabase/migrations/` for RLS policies

### Risk 5: Environment Variable Leaks

**Symptom:** Secrets in logs or error messages
**Likely Cause:** Not using proper validation/sanitization
**Diagnosis:**

```bash
grep -r "process.env" --include="*.ts" | grep -v "node_modules" | head -20
```

**Fix:** Use Zod schemas for validation, never log env vars

### Risk 6: Dead Code

**Symptom:** Unused imports, files not referenced
**Likely Cause:** Refactoring left behind artifacts
**Diagnosis:**

```bash
pnpm run lint  # ESLint will flag unused vars
```

**Fix:** Remove unused imports and files

---

## 6) Roadmap (Next 30/60/90 Days)

### 30 Days — Stabilize

- [ ] Fix known issues from Risk section above
- [ ] Complete Python worker test coverage (pytest suite)
- [ ] Add missing error boundaries to web app
- [ ] Centralize design tokens in `packages/design-system/`
- [ ] Document all env vars in `.env.example` files
- [ ] Add database migration verification to CI

### 60 Days — Enforce

- [ ] CI gates for contract test coverage thresholds
- [ ] Import boundary audit (all workspace imports verified)
- [ ] Merge duplicate docs (AUDIT_NOTES.md, REALITY_MAP.md)
- [ ] Web app route smoke tests (Playwright)
- [ ] Adapter contract tests for all adapters
- [ ] TypeScript strict mode compliance audit

### 90 Days — Scale

- [ ] SDK documentation site (generated from types)
- [ ] Benchmark suite for job throughput
- [ ] Multi-region deployment guide
- [ ] Worker auto-scaling configuration
- [ ] Schema versioning and rollback strategy
- [ ] Observability dashboard UI

---

## 7) Definition of Done (DoD)

**Ship-ready means:**

1. **Commands Green**
   - `pnpm run verify:fast` passes (format, lint, typecheck)
   - `pnpm test` passes
   - `pnpm run build` succeeds
   - `pnpm jobforge:doctor` reports healthy

2. **Pages Load**
   - Web app starts without errors
   - Worker starts and polls successfully
   - No hard-500 routes

3. **No Fake Claims**
   - All metrics/numbers are real
   - No invented customers or testimonials
   - No placeholder functionality

4. **Tests Cover Changes**
   - Unit tests for new code
   - Contract tests if changing runners
   - Manual smoke test for UI changes

5. **Documentation Updated**
   - README updated if needed
   - ARCHITECTURE.md updated for structural changes
   - CLI.md updated for new commands

6. **Clean Commit**
   - No dead imports
   - No unused files
   - No secrets in code
   - Conventional commit message

---

## Appendix: Quick Reference

**When in doubt, check:**

1. `AGENTS.md` — operational guidelines
2. `README.md` — project overview
3. `docs/ARCHITECTURE.md` — system design
4. `docs/RUNBOOK.md` — operations guide

**Emergency contacts:**

- CI failing? Check `.github/workflows/ci.yml`
- Tests failing? Check `packages/shared/test/`
- Build failing? Check `turbo.json` task dependencies

---

_This document is a living guide. Update it as capabilities evolve._
