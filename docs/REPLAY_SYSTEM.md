# JobForge Deterministic Replay System

The replay system captures run provenance for deterministic replay, enabling audit trails, debugging, and compliance requirements.

## Overview

Every runnerless/autopilot run can be captured as a **replay bundle** containing:

- **Inputs Snapshot**: Canonicalized inputs with SHA-256 hash (stable key order)
- **Code Fingerprint**: Git SHA, branch, and dirty status
- **Runtime Fingerprint**: Node.js and pnpm versions, platform, architecture
- **Dependency Fingerprint**: Lockfile hash and dependency count
- **Environment Fingerprint**: Non-secret environment identifiers and feature flags

## Feature Flag

The replay system is controlled by the `REPLAY_PACK_ENABLED` feature flag:

```bash
# Disabled by default (REPLAY_PACK_ENABLED=0)
REPLAY_PACK_ENABLED=0  # No replay bundles are captured

# Enable to capture replay data
REPLAY_PACK_ENABLED=1  # All runs capture provenance
```

## CLI Usage

### Export Replay Bundle

```bash
# Export a replay bundle for a run
REPLAY_PACK_ENABLED=1 tsx scripts/replay-cli.ts export run-123 \
  --tenant tenant-1 \
  --job connector.http.request \
  --inputs '{"url":"https://api.example.com","method":"POST"}'

# Output saved to ./replays/replay-run-123-<timestamp>.json
```

### Dry-Run Replay

```bash
# Replay a bundle without side effects
tsx scripts/replay-cli.ts dry-run ./replays/replay-run-123-2024-01-15.json

# Shows differences between original and current environment
```

## Bundle Format

### replay.json

```json
{
  "version": "1.0",
  "provenance": {
    "runId": "run-uuid",
    "tenantId": "tenant-uuid",
    "jobType": "connector.http.request",
    "inputs": {
      "canonicalJson": "{\"body\":{},\"method\":\"POST\",\"url\":\"...\"}",
      "hash": "sha256-of-canonical-json",
      "originalKeys": ["url", "method", "body"],
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    "code": {
      "gitSha": "a1b2c3d4...",
      "gitBranch": "main",
      "gitDirty": false,
      "timestamp": "2024-01-15T10:30:00.000Z"
    },
    "runtime": {
      "nodeVersion": "v20.11.0",
      "pnpmVersion": "8.15.0",
      "platform": "linux",
      "arch": "x64"
    },
    "dependencies": {
      "lockfileHash": "sha256-of-pnpm-lock-yaml",
      "packageHash": "sha256-of-package-json",
      "dependencyCount": 147
    },
    "environment": {
      "identifiers": {
        "NODE_ENV": "production",
        "AWS_REGION": "us-east-1"
      },
      "envType": "production",
      "featureFlags": {
        "REPLAY_PACK_ENABLED": true
      }
    }
  },
  "logRefs": ["path/to/execution.log"],
  "artifactRefs": ["path/to/artifact.json"],
  "metadata": {
    "exportedAt": "2024-01-15T12:00:00.000Z",
    "exportedBy": "system",
    "isDryRun": false
  }
}
```

### manifest.json

```json
{
  "version": "1.0",
  "exportedAt": "2024-01-15T12:00:00.000Z",
  "files": {
    "replay.json": "replay-run-uuid-timestamp.json"
  },
  "runId": "run-uuid",
  "tenantId": "tenant-uuid",
  "jobType": "connector.http.request"
}
```

## Canonicalization

Inputs are canonicalized for stable hashing:

1. Keys sorted alphabetically (deterministic)
2. Undefined values removed
3. Nested objects recursively sorted
4. Arrays preserve order but elements are canonicalized

Example:

```javascript
// Original input
{ z: 1, a: { c: 2, b: 1 } }

// Canonical JSON
{"a":{"b":1,"c":2},"z":1}
```

This ensures the same inputs produce the same hash regardless of key insertion order.

## Security

- **No Secrets**: Environment fingerprint only includes safe patterns (NODE*ENV, JOBFORGE*\_, VERCEL\_\_, AWS_REGION, etc.)
- **Secret Exclusion**: Keys containing SECRET, KEY, TOKEN, PASSWORD, or CREDENTIAL are automatically excluded
- **Redaction**: Values matching secret patterns are redacted with `***REDACTED***`

## API

### Capture Provenance

```typescript
import { captureRunProvenance } from '@jobforge/shared'

const provenance = await captureRunProvenance(
  'run-123',
  'tenant-1',
  'connector.http.request',
  { url: 'https://api.example.com', method: 'POST' },
  'project-456' // optional
)

// Returns null if REPLAY_PACK_ENABLED=0
```

### Export Bundle

```typescript
import { exportReplayBundle } from '@jobforge/shared'

const bundle = await exportReplayBundle(
  'run-123',
  'tenant-1',
  'connector.http.request',
  { url: 'https://api.example.com' },
  {
    projectId: 'project-456',
    logRefs: ['logs/run-123.log'],
    artifactRefs: ['artifacts/run-123.json'],
    isDryRun: false,
    exportedBy: 'system',
  }
)
```

### Replay Dry-Run

```typescript
import { replayDryRun, type ReplayBundle } from '@jobforge/shared'

const result = await replayDryRun(bundle, {
  compareResults: true,
  maxLogLines: 1000,
})

// result.success - whether replay completed
// result.differences - any environment/version differences
// result.logs - simulation logs
```

### Verify Input Hash

```typescript
import { verifyInputHash } from '@jobforge/shared'

const isValid = verifyInputHash({ url: 'https://api.example.com' }, 'expected-sha256-hash')
```

## Testing

Run the replay system tests:

```bash
pnpm --filter @jobforge/shared test
```

Tests cover:

- Canonicalization (key ordering, nested objects, arrays)
- Hash stability (same inputs = same hash)
- Feature flag integration
- Bundle comparison
- Dry-run simulation

## Compliance

The replay system supports:

- **Audit trails**: Complete provenance for every run
- **Reproducibility**: Exact inputs and environment captured
- **Verification**: Hash-based input integrity checking
- **Retention**: Bundle files can be archived per compliance requirements
