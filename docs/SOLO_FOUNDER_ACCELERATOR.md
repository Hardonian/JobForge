# JobForge Solo-Founder Accelerator Layer

**Version**: 1.0.0  
**Date**: 2026-02-02  
**Status**: Production Ready (with feature flags OFF by default)

---

## Overview

The Solo-Founder Accelerator Layer adds operational tooling to JobForge so the entire system can be operated, debugged, upgraded, and governed with minimal cognitive load. All features are **disabled by default** (safe defaults) and require explicit opt-in via feature flags.

---

## Architecture Principles

1. **Defaults OFF** - All new features disabled by default
2. **No Redundancy** - Uses existing primitives (no new schedulers/workers/secret stores)
3. **Tenant/Project Scoping** - Mandatory everywhere
4. **No Secrets Leakage** - Redaction + safe error serialization
5. **Deterministic & Auditable** - Everything ties back to evidence
6. **No Autonomy Creep** - Actions require explicit policy tokens + flags

---

## New Commands

### 1. `pnpm jobforge:doctor` - System Doctor

Health check and diagnostics for the operator.

**Feature Flag**: `JOBFORGE_DOCTOR_ENABLED=1`

**Checks**:

- Node.js/pnpm versions
- Lockfile presence
- Required env vars (without printing secrets)
- DB connectivity & migrations
- Trigger status
- Bundle executor readiness
- Replay bundle readiness
- Disk space
- Unsafe flags in production

**Usage**:

```bash
# Enable and run
JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor

# JSON output for CI/CD
JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor --json

# Apply fixes (requires confirmation)
JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor --apply
```

**Safety**:

- Never auto-applies changes by default
- Secrets are redacted in output
- Requires explicit `JOBFORGE_DOCTOR_ENABLED=1`
- Auto-fix requires `JOBFORGE_DOCTOR_AUTO_FIX=1` or `--yes`

---

### 2. `pnpm jobforge:impact:show` - Impact Map (TruthCore-lite)

Deterministic impact mapper showing event → bundle_run → child_run → artifact relationships.

**Feature Flag**: `JOBFORGE_IMPACT_MAP_ENABLED=1`

**Usage**:

```bash
# Show impact tree
JOBFORGE_IMPACT_MAP_ENABLED=1 pnpm jobforge:impact:show --run run-123

# Export as JSON
pnpm jobforge:impact:export --run run-123

# Compare two runs
pnpm jobforge:impact:compare --run-a run-1 --run-b run-2
```

**Output Format**:

```json
{
  "version": "1.0",
  "runId": "run-uuid",
  "tenantId": "tenant-uuid",
  "nodes": [...],
  "edges": [...],
  "rootNodeId": "run-uuid"
}
```

**Constraints**:

- No ML or heavy graph DB
- Stored as artifact JSON
- Stable hashing for reproducibility
- Deterministic ordering

---

### 3. `pnpm jobforge:daily` - Daily Operator Loop

The "solo founder daily" - comprehensive daily check with safe defaults.

**Feature Flag**: `JOBFORGE_DAILY_RUN_ENABLED=1`

**What it does**:

1. Runs doctor
2. Lists last 24h bundle runs by tenant/project
3. Highlights failures/anomalies
4. Exports daily summary (JSON + Markdown)
5. Provides dry-run recommendations only

**Usage**:

```bash
# Daily check
JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily

# Dry run (read-only)
JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --dry

# Filter by tenant
JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --tenant tenant-123
```

**Output**:

- `.jobforge/daily/daily-summary-YYYY-MM-DD.json`
- `.jobforge/daily/daily-summary-YYYY-MM-DD.md`

---

## Policy Guard (Stage 2)

Enforceable policy layer preventing silent expansion of automation authority.

**Feature Flag**: `JOBFORGE_POLICY_GUARD_ENABLED=1`

### Automation Levels

| Level                | Description                                    |
| -------------------- | ---------------------------------------------- |
| `OBSERVE_ONLY`       | Read-only operations                           |
| `RECOMMEND_ONLY`     | Suggest actions, never execute                 |
| `EXECUTE_NON_ACTION` | Execute safe, non-destructive jobs             |
| `EXECUTE_ACTION`     | Execute action jobs (requires explicit opt-in) |

**Default**: `RECOMMEND_ONLY`

### Usage

```typescript
import { policyGuard, isJobExecutionAllowed } from '@jobforge/shared'

// Set tenant policy
policyGuard.setTenantPolicy({
  tenantId: 'tenant-uuid',
  automationLevel: AutomationLevel.RECOMMEND_ONLY,
  allowedJobTypes: ['autopilot.ops.scan'],
  requirePolicyTokenForActions: true,
})

// Check if job is allowed
const decision = policyGuard.evaluateJobExecution('tenant-uuid', 'autopilot.ops.apply', {
  policyToken: 'token-here',
})

if (!decision.allowed) {
  console.log(`Denied: ${decision.reason}`)
}
```

### Drift Detection

```typescript
// CI check
const drift = policyGuard.detectDrift()
if (drift.hasDrift) {
  console.error('Uncategorized job types:', drift.uncategorizedJobs)
  process.exit(1)
}
```

### Enforcement Points

1. **Bundle Executor** - Validates jobs before execution
2. **Action-like Job Templates** - Requires policy token
3. **Trigger Evaluation Engine** - Checks automation level

---

## Upgrade Lane (Stage 4)

Version negotiation and compatibility management for JobRequestBundles.

**Feature Flag**: `JOBFORGE_UPGRADE_LANE_ENABLED=1`

### Supported Versions

- **Current**: `1.0.0`
- **Min Bundle**: `1.0.0`
- **Max Bundle**: `1.1.0`
- **N-1 Support**: Yes

### Usage

```typescript
import { checkCompatibility, validateBundleVersion, getSuggestedMigration } from '@jobforge/shared'

// Validate bundle
const validation = validateBundleVersion(bundle)
if (!validation.valid) {
  console.error('Errors:', validation.errors)
}

// Check compatibility
const compat = checkCompatibility(bundle)
if (!compat.compatible) {
  console.log(`Incompatible: ${compat.reason}`)
  console.log(`Action: ${compat.suggestedAction}`)
}

// Get migration info
const migration = getSuggestedMigration('1.0.0')
```

### CI Integration

```bash
# Add to CI pipeline
pnpm jobforge:validate-bundle --bundle ./bundle.json
```

---

## Feature Flags Reference

| Flag                             | Default | Description                                |
| -------------------------------- | ------- | ------------------------------------------ |
| `JOBFORGE_DOCTOR_ENABLED`        | `0`     | Enable system doctor                       |
| `JOBFORGE_POLICY_GUARD_ENABLED`  | `0`     | Enable policy guard                        |
| `JOBFORGE_IMPACT_MAP_ENABLED`    | `0`     | Enable impact mapping                      |
| `JOBFORGE_DAILY_RUN_ENABLED`     | `0`     | Enable daily run                           |
| `JOBFORGE_UPGRADE_LANE_ENABLED`  | `0`     | Enable version negotiation                 |
| `JOBFORGE_ACTION_JOBS_ENABLED`   | `0`     | Enable action jobs (requires policy token) |
| `JOBFORGE_REQUIRE_POLICY_TOKENS` | `1`     | Require policy tokens for actions          |

---

## Rollback Plan

### Immediate Rollback

All features are controlled by feature flags. To disable:

```bash
# Disable all accelerator features
export JOBFORGE_DOCTOR_ENABLED=0
export JOBFORGE_POLICY_GUARD_ENABLED=0
export JOBFORGE_IMPACT_MAP_ENABLED=0
export JOBFORGE_DAILY_RUN_ENABLED=0
export JOBFORGE_UPGRADE_LANE_ENABLED=0
export JOBFORGE_ACTION_JOBS_ENABLED=0
```

### Per-Feature Rollback

```bash
# Disable only doctor
JOBFORGE_DOCTOR_ENABLED=0 pnpm jobforge:doctor

# Disable only policy guard
JOBFORGE_POLICY_GUARD_ENABLED=0

# Disable only impact mapping
JOBFORGE_IMPACT_MAP_ENABLED=0
```

### Database Rollback

If database migrations need to be rolled back:

```bash
# Restore from backup
cd supabase
supabase db restore --from-backup

# Or manually drop new tables
psql -c "DROP TABLE IF EXISTS jobforge_bundle_trigger_rules CASCADE;"
psql -c "DROP TABLE IF EXISTS jobforge_trigger_evaluations CASCADE;"
```

### Safety Defaults Recap

1. **All features OFF by default** - No surprise behavior
2. **Explicit opt-in required** - Each feature needs its flag
3. **No auto-actions** - Even with flags, no automatic execution
4. **Policy tokens for actions** - Write operations require explicit tokens
5. **Dry-run available** - Test without side effects
6. **Deterministic** - Same inputs = same outputs

---

## Integration with Apps

### Settler, ReadyLayer, Keys, AIAS

The four runnerless OSS modules can use the accelerator layer:

```typescript
import {
  policyGuard,
  createImpactMapFromExecution,
  validateBundleVersion
} from '@jobforge/shared'

// Before executing a bundle
const bundle = {
  version: { schema_version: '1.0.0' },
  tenant_id: 'tenant-uuid',
  jobs: [...]
}

// 1. Validate version
const validation = validateBundleVersion(bundle)
if (!validation.valid) throw new Error('Invalid bundle')

// 2. Check policy
const decision = policyGuard.evaluateJobExecution(
  bundle.tenant_id,
  'settler.contract.process',
  { policyToken }
)
if (!decision.allowed) throw new Error(decision.reason)

// 3. Execute with impact tracking
const result = await executeBundle(bundle)
const impactGraph = createImpactMapFromExecution(runId, tenantId, {
  jobType: 'settler.contract.process',
  inputs: bundle,
  artifacts: result.artifacts
})
```

---

## Testing

### Unit Tests

```bash
# Test doctor
pnpm --filter @jobforge/shared test -- doctor.test.ts

# Test policy guard
pnpm --filter @jobforge/shared test -- policy-guard.test.ts

# Test impact map
pnpm --filter @jobforge/shared test -- impact-map.test.ts

# Test upgrade lane
pnpm --filter @jobforge/shared test -- upgrade-lane.test.ts
```

### Integration Tests

```bash
# Run contract tests
pnpm contract-tests

# Run full test suite (excluding Python)
pnpm test -- --exclude @jobforge/worker-py --exclude @jobforge/python-worker
```

### Manual Testing

```bash
# Test doctor
JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor

# Test impact map
JOBFORGE_IMPACT_MAP_ENABLED=1 pnpm jobforge:impact:show --run test-run

# Test daily run
JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --dry
```

---

## Files Added

### Core Modules

- `packages/shared/src/doctor.ts` - System doctor implementation
- `packages/shared/src/policy-guard.ts` - Policy guard with drift detection
- `packages/shared/src/impact-map.ts` - Impact mapping (TruthCore-lite)
- `packages/shared/src/upgrade-lane.ts` - Version negotiation

### CLI Scripts

- `scripts/jobforge-doctor.ts` - Doctor CLI
- `scripts/jobforge-impact.ts` - Impact map CLI
- `scripts/jobforge-daily.ts` - Daily run CLI

### Updated Files

- `packages/shared/src/feature-flags.ts` - Added new feature flags
- `packages/shared/src/index.ts` - Export new modules
- `package.json` - Added npm scripts

---

## Compliance Checklist

- ✅ No breaking changes - all existing tests pass
- ✅ Defaults OFF - all new features disabled by default
- ✅ Tenant/project scoping - enforced everywhere
- ✅ No secrets leakage - redaction in all outputs
- ✅ Deterministic - stable hashes, reproducible outputs
- ✅ No autonomy creep - explicit policy tokens required
- ✅ Lint passes - no new lint errors
- ✅ Typecheck passes - all TypeScript compiles

---

## Next Steps

1. **Enable in staging** - Test with `JOBFORGE_*_ENABLED=1`
2. **Run daily checks** - Schedule `pnpm jobforge:daily` in CI
3. **Enable policy guard** - Set tenant policies
4. **Monitor impact maps** - Review `.jobforge/impact/` output
5. **Upgrade bundles** - Validate new bundle versions

---

## Support

For issues or questions:

- Check `docs/REALITY_MAP.md` for architecture overview
- Review `docs/REPLAY_SYSTEM.md` for provenance tracking
- See `docs/SECURITY.md` for security model
