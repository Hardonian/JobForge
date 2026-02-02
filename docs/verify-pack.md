# autopilot.readylayer.verify_pack

ReadyLayer Verify Pack - First-class autopilot job type for local codebase verification.

## Overview

This job type performs comprehensive local verification of a codebase without requiring network access. It's designed to work offline-first and provides structured reporting with artifact manifests.

## Job Type

```
autopilot.readylayer.verify_pack
```

## Feature Flags

This job type is protected by feature flags and requires explicit opt-in:

| Flag                              | Default        | Required |
| --------------------------------- | -------------- | -------- |
| `JOBFORGE_AUTOPILOT_JOBS_ENABLED` | `0` (disabled) | ✅ Yes   |
| `VERIFY_PACK_ENABLED`             | `0` (disabled) | ✅ Yes   |

Both flags must be set to `1` for the job to execute. If disabled, the job returns a structured failure result without throwing errors.

## Input Schema

```typescript
interface VerifyPackPayload {
  /** Local repository path (mutually exclusive with repoRef) */
  repoPath?: string

  /** Repository reference - only 'local:' prefix supported in offline mode */
  repoRef?: string

  /** Verification pack type */
  pack: 'fast' | 'full'

  /** Optional configuration */
  options?: {
    /** Skip lint step */
    skipLint?: boolean
    /** Skip typecheck step */
    skipTypecheck?: boolean
    /** Skip build step */
    skipBuild?: boolean
    /** Skip test step (only applies to 'full' pack) */
    skipTest?: boolean
    /** Additional custom commands to run */
    customCommands?: string[]
    /** Environment variables to inject */
    env?: Record<string, string>
  }
}
```

### Pack Types

- **`fast`**: Runs lint, typecheck, build (in that order)
- **`full`**: Runs fast pack + tests

### Path Resolution

- If `repoPath` is provided:
  - Absolute paths are used as-is
  - Relative paths are resolved against `process.cwd()`
- If `repoRef` is provided (format: `local:/path/to/repo`):
  - The `local:` prefix is stripped and the path is used
  - Network-based repoRef is not supported (offline-first design)
- If neither is provided:
  - Defaults to `process.cwd()`

## Output

### Success Response

```typescript
interface VerifyPackResult {
  success: boolean
  report: VerifyReport
  manifest: ArtifactManifest
  artifact_ref?: string
}
```

### Report Structure

```typescript
interface VerifyReport {
  repo_path: string
  pack: 'fast' | 'full'
  summary: {
    total: number // Total commands executed
    passed: number // Commands that succeeded
    failed: number // Commands that failed
    skipped: number // Commands skipped (no script available)
    duration_ms: number // Total execution time
  }
  commands: CommandResult[]
  fingerprints: {
    package_json_hash: string | null // SHA256 of package.json
    lockfile_hash: string | null // SHA256 of lockfile (pnpm/yarn/npm)
    file_count: number // Total files in repo
    total_size_bytes: number // Total repo size
  }
  issues: Array<{
    severity: 'error' | 'warning'
    message: string
    command?: string
  }>
  generated_at: string // ISO timestamp
}
```

### Command Result

```typescript
interface CommandResult {
  command: string // Full command executed
  success: boolean // Whether command succeeded
  exitCode: number // Process exit code
  stdout: string // Standard output (capped at 100KB)
  stderr: string // Standard error (capped at 100KB)
  durationMs: number // Execution time
  skipped?: boolean // Whether command was skipped
  reason?: string // Reason for skip (e.g., "script not found")
}
```

### Manifest

The job outputs a canonical `ArtifactManifest` with:

- **Outputs**: JSON report and issues log (if any issues)
- **Metrics**: Duration, file count, total size
- **Env Fingerprint**: OS, architecture, Node version
- **Tool Versions**: JobForge version, connector versions, package manager
- **Status**: `complete` or `failed`
- **Logs Ref**: Path to log storage

## Error Handling

This job type **never throws uncaught errors**. All failures are captured as structured results:

1. **Feature flag disabled**: Returns failure result with `FEATURE_FLAG_DISABLED` code
2. **Invalid payload**: Returns failure with validation errors
3. **Command failure**: Captured in `CommandResult` with full output
4. **Unexpected errors**: Wrapped in structured error result with stack trace

## Package Manager Detection

The handler auto-detects the package manager:

1. **pnpm**: If `pnpm-lock.yaml` exists
2. **yarn**: If `yarn.lock` exists
3. **npm**: Default fallback

## Script Detection

Scripts are dynamically detected from `package.json`. If a script doesn't exist:

- The command is marked as `skipped: true`
- A reason is provided (e.g., "lint script not found in package.json")
- The overall job does not fail (graceful degradation)

## Usage Examples

### TypeScript SDK

```typescript
import { JobForgeClient } from '@jobforge/sdk-ts'

const client = new JobForgeClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
})

// Fast pack verification
const job = await client.enqueueJob({
  tenant_id: 'your-tenant-id',
  type: 'autopilot.readylayer.verify_pack',
  payload: {
    repoPath: '/path/to/repo',
    pack: 'fast',
    options: {
      skipLint: false,
      skipTypecheck: false,
      skipBuild: false,
    },
  },
  idempotency_key: `verify-pack-${Date.now()}`,
})

// Full pack with tests
const fullJob = await client.enqueueJob({
  tenant_id: 'your-tenant-id',
  type: 'autopilot.readylayer.verify_pack',
  payload: {
    repoPath: '/path/to/repo',
    pack: 'full',
  },
  idempotency_key: `verify-pack-full-${Date.now()}`,
})
```

### Python SDK

```python
from jobforge_sdk import JobForgeClient

client = JobForgeClient(
    supabase_url=os.environ['SUPABASE_URL'],
    supabase_key=os.environ['SUPABASE_SERVICE_ROLE_KEY']
)

# Fast pack verification
job = client.enqueue_job(
    tenant_id='your-tenant-id',
    type='autopilot.readylayer.verify_pack',
    payload={
        'repoPath': '/path/to/repo',
        'pack': 'fast',
        'options': {
            'skipLint': False,
            'skipTypecheck': False,
            'skipBuild': False,
        }
    },
    idempotency_key=f'verify-pack-{int(time.time())}'
)
```

### Direct Handler Usage

```typescript
import { verifyPackHandler } from '@jobforge/shared'

const result = await verifyPackHandler(
  {
    repoPath: '/path/to/repo',
    pack: 'full',
  },
  {
    job_id: 'job-uuid',
    tenant_id: 'tenant-uuid',
    attempt_no: 1,
    trace_id: 'trace-uuid',
    heartbeat: async () => {},
  }
)

console.log(`Success: ${result.success}`)
console.log(`Report:`, result.report)
console.log(`Manifest:`, result.manifest)
```

## Environment Variables

### Required (for execution)

```bash
export JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
export VERIFY_PACK_ENABLED=1
```

### Optional (for handler context)

```bash
# Standard JobForge worker environment
export SUPABASE_URL=https://your-project.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=your-service-key
export WORKER_ID=worker-1
```

## Smoke Testing

Run the smoke test against the JobForge repo itself:

```bash
# Set feature flags
export JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
export VERIFY_PACK_ENABLED=1

# Run smoke test
npx tsx scripts/smoke-test-verify-pack.ts
```

The smoke test:

1. Verifies feature flag protection (disabled case)
2. Runs fast pack (lint + typecheck + build)
3. Runs full pack (includes tests)
4. Generates and saves artifacts
5. Reports structured results

## Implementation Details

### Timeout

Default timeout: **10 minutes** (600,000ms)

Individual commands timeout after **5 minutes** (300,000ms)

### Output Limits

- Command stdout/stderr: Capped at **100KB** per stream
- Report JSON size: Unbounded (be mindful of very large repos)

### Security

- All paths are resolved using `path.resolve()` for cross-platform safety
- No network access required (offline-first design)
- Environment variables can be injected via `options.env`
- Commands run with `CI=true` and `NODE_ENV=test` for consistent behavior

## Files

- **Handler**: `packages/shared/src/verify-pack.ts`
- **Registration**: `services/worker-ts/src/handlers/index.ts`
- **Smoke Test**: `scripts/smoke-test-verify-pack.ts`
- **Docs**: `docs/verify-pack.md` (this file)

## See Also

- [Execution Plane Contract](execution-plane-contract.md)
- [Feature Flags](../packages/shared/src/feature-flags.ts)
- [Job Types](../packages/shared/src/types.ts)
