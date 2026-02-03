# JobForge CLI Catalog

This document is generated to keep CLI help and documentation consistent with code. All commands support `--help` (or `help`) for detailed usage and examples.

## Core CLIs

| Command | What it does | Inputs | Outputs | Common options | Example invocation |
| --- | --- | --- | --- | --- | --- |
| `pnpm jobforge:doctor` | Run system health checks and optional safe auto-fixes. | Env: `JOBFORGE_DOCTOR_ENABLED=1`. | Human or JSON report to stdout. | `--json`, `--apply`, `--yes` | `JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor --json` |
| `pnpm jobforge:impact:show --run <id>` | Render an impact map tree or JSON for a run. | Impact graph in `.jobforge/impact/` or `.jobforge/artifacts/`. | Tree or JSON to stdout. | `--run`, `--json`, `--tenant`, `--project` | `pnpm jobforge:impact:show --run demo-run-001` |
| `pnpm jobforge:impact:export --run <id>` | Export an impact graph to a JSON file. | Impact graph in `.jobforge/impact/` or `.jobforge/artifacts/`. | JSON file in output dir. | `--run`, `--output` | `pnpm jobforge:impact:export --run demo-run-001 --output .jobforge/impact` |
| `pnpm jobforge:impact:compare --run-a <id> --run-b <id>` | Compare two impact graphs. | Two impact graph files. | Comparison report to stdout. | `--run-a`, `--run-b`, `--tenant` | `pnpm jobforge:impact:compare --run-a run-a --run-b run-b` |
| `pnpm jobforge:daily` | Run daily operator loop and export reports. | Env: `JOBFORGE_DAILY_RUN_ENABLED=1`. | JSON + Markdown report files. | `--dry`, `--tenant`, `--output` | `JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --dry` |
| `tsx scripts/replay-cli.ts export <run-id>` | Export a replay bundle. | Env: `REPLAY_PACK_ENABLED=1`. | `replay-*.json` + `manifest-*.json` in output dir. | `--tenant`, `--job`, `--inputs`, `--output` | `REPLAY_PACK_ENABLED=1 tsx scripts/replay-cli.ts export run-123 --tenant tenant-1 --job connector.http.request` |
| `tsx scripts/replay-cli.ts dry-run <bundle>` | Dry-run a replay bundle. | Replay bundle JSON. | Summary + logs to stdout. | `--max-logs`, `--compare` | `tsx scripts/replay-cli.ts dry-run ./replays/replay-run-123.json` |

## Worker CLIs

| Command | What it does | Inputs | Outputs | Common options | Example invocation |
| --- | --- | --- | --- | --- | --- |
| `jobforge-worker` | Run the TypeScript worker (polls Supabase). | Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. | Worker logs. | `--once`, `--interval` | `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... jobforge-worker --once` |
| `jobforge-console <command>` | Ops console for bundle runs, trigger rules, and replays. | Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. | Tables/JSON to stdout; optional replay file. | `--tenant`, `--project`, `--json` | `jobforge-console bundles:list --tenant=tenant-demo` |
| `python -m jobforge_worker.cli` | Run the Python worker. | Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. | Worker logs. | `--once`, `--interval` | `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m jobforge_worker.cli --once` |

## Test & Validation CLIs

| Command | What it does | Inputs | Outputs | Common options | Example invocation |
| --- | --- | --- | --- | --- | --- |
| `node packages/shared/test/contract-test-runner.ts` | Run contract validation tests against fixtures. | Fixture files in `packages/shared/test/fixtures`. | Report to stdout. | (none) | `node packages/shared/test/contract-test-runner.ts` |
| `pnpm modules:sync-fixtures` | Sync module fixture outputs into JobForge fixtures (optional). | Env: module repo paths. | Updated fixture files in `packages/shared/test/fixtures/modules`. | `JOBFORGE_MODULE_REPOS`, `JOBFORGE_MODULE_<MODULE>_REPO` | `JOBFORGE_MODULE_OPS_REPO=../ops pnpm modules:sync-fixtures` |
| `node scripts/smoke-test-autopilot.js` | Quick smoke test for autopilot integration. | Built `worker-ts` dist handlers. | Summary to stdout. | (none) | `pnpm run build && node scripts/smoke-test-autopilot.js` |
| `node scripts/prove-autopilot-integration.js` | Deterministic autopilot integration tests. | Built `worker-ts` dist handlers. | Summary to stdout. | (none) | `pnpm run build && node scripts/prove-autopilot-integration.js` |
| `node scripts/smoke-test-final.ts` | Runnerless execution plane smoke test. | Optional feature flags + Supabase env. | Summary to stdout. | `--with-flags` | `node scripts/smoke-test-final.ts` |
| `node scripts/smoke-test-verify-pack.ts` | verify_pack handler smoke test. | Local repo tooling. | Reports + artifacts in `.jobforge/artifacts`. | (none) | `node scripts/smoke-test-verify-pack.ts` |
| `node scripts/smoke-test-execution-plane.ts` | Execution plane substrate smoke test. | Optional Supabase env. | Summary to stdout. | (none) | `node scripts/smoke-test-execution-plane.ts` |
| `tsx scripts/mcp-smoke.ts` | MCP server smoke test. | Built MCP server. | Summary + MCP responses to stdout. | (none) | `pnpm --filter @jobforge/mcp-server build && tsx scripts/mcp-smoke.ts` |

## Docs Verification

Run the docs verification script to check CLI help output and examples:

```bash
pnpm docs:verify
```

This script:

- Checks `--help` output for all CLI entrypoints.
- Re-runs reproducible README examples with fixtures.
- Verifies tracked example outputs in `examples/output/`.

## Module Fixture Sync (Dev Workflow)

To validate module compatibility with fixtures emitted by local module repos, point JobForge at those repos and sync:

```bash
export JOBFORGE_MODULE_REPOS='{"ops":"../jobforge-ops","support":"../jobforge-support","growth":"../jobforge-growth","finops":"../jobforge-finops"}'
pnpm modules:sync-fixtures
pnpm contract-tests
```

You can also configure per-module paths:

```bash
export JOBFORGE_MODULE_OPS_REPO=../jobforge-ops
export JOBFORGE_MODULE_SUPPORT_REPO=../jobforge-support
export JOBFORGE_MODULE_GROWTH_REPO=../jobforge-growth
export JOBFORGE_MODULE_FINOPS_REPO=../jobforge-finops
pnpm modules:sync-fixtures
```

If no module repos are configured, JobForge uses the fixtures committed in `packages/shared/test/fixtures` during `pnpm contract-tests`.
