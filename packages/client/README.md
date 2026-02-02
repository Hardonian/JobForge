# @jobforge/client

TypeScript client for JobForge runnerless execution plane.

## Overview

This package provides a unified client for interacting with the JobForge execution plane, supporting:

- Event envelope submission
- Job requests
- Run status queries
- Artifact manifest retrieval
- Artifact listing

## Installation

```bash
pnpm add @jobforge/client
```

## Usage

### Basic Setup

```typescript
import { createClient } from '@jobforge/client'

const client = createClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,
  defaultTenantId: 'your-tenant-id',
})
```

### Submit Event

```typescript
import type { EventEnvelope } from '@jobforge/client'

const envelope: EventEnvelope = {
  event_version: '1.0',
  event_type: 'user.action',
  occurred_at: new Date().toISOString(),
  trace_id: 'trace-123',
  tenant_id: 'tenant-456',
  source_app: 'settler',
  payload: { action: 'click' },
  contains_pii: false,
}

const event = await client.submitEvent(envelope)
```

### Request Job

```typescript
const result = await client.requestJob(
  'autopilot.ops.scan',
  { scan_type: 'full' },
  'tenant-id',
  'project-id',
  'trace-id',
  'idempotency-key' // optional
)

console.log(`Job requested: ${result.runId}`)
```

### Get Run Status

```typescript
const status = await client.getRunStatus('run-id', 'tenant-id')
console.log(`Status: ${status.status}`)
```

### Get Run Manifest

```typescript
const manifest = await client.getRunManifest('run-id', 'tenant-id')
console.log(`Outputs: ${manifest?.outputs.length}`)
```

### List Artifacts

```typescript
const artifacts = await client.listArtifacts('run-id', 'tenant-id')
console.log(`Artifacts: ${artifacts.totalCount}`)
```

## Transports

### Direct Transport (Default)

Uses `@jobforge/sdk-ts` directly. Best for same-monorepo usage.

```typescript
const client = createClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,
})
```

### HTTP Transport

Uses HTTP API endpoint. Use when JobForge has an HTTP API layer.

```typescript
const client = createClient({
  apiEndpoint: 'https://api.jobforge.io',
  apiKey: process.env.JOBFORGE_API_KEY,
})
```

## Feature Flags

All integration features are disabled by default. Set these environment variables to enable:

| Variable                       | Default                       | Description                                 |
| ------------------------------ | ----------------------------- | ------------------------------------------- |
| `JOBFORGE_INTEGRATION_ENABLED` | `0`                           | Enable the integration client               |
| `JOBFORGE_DRY_RUN_MODE`        | `1` (if integration disabled) | Run in dry-run mode (no side effects)       |
| `JOBFORGE_API_ENDPOINT`        | (none)                        | HTTP API endpoint (if using HTTP transport) |
| `JOBFORGE_API_KEY`             | (none)                        | API key for HTTP transport                  |

### Safety First

The client defaults to **dry-run mode** when integration is disabled. This means:

- All calls return mock responses
- No actual database writes occur
- Safe to run in CI/CD or development

To enable real operations:

```bash
export JOBFORGE_INTEGRATION_ENABLED=1
export JOBFORGE_DRY_RUN_MODE=0
```

## Examples by App

See the `examples/` directory for app-specific usage patterns:

- `settler.ts` - Contract processing workflows
- `aias.ts` - AI/ML training and inference jobs
- `keys.ts` - API key rotation and security scans
- `readylayer.ts` - Cache management and CDN operations

Run an example:

```bash
cd packages/client
npx tsx examples/settler.ts
```

## Scripts

### Smoke Test

Run the smoke test in dry-run mode (no side effects):

```bash
pnpm smoke
```

This validates that the client can be instantiated and all methods work in mock mode.

## API Reference

### `createClient(config?)`

Creates a new ExecutionPlaneClient instance.

**Parameters:**

- `config.supabaseUrl` - Supabase URL (for direct transport)
- `config.supabaseKey` - Supabase service key (for direct transport)
- `config.apiEndpoint` - HTTP API endpoint (for HTTP transport)
- `config.apiKey` - API key (for HTTP transport)
- `config.defaultTenantId` - Default tenant ID for requests
- `config.dryRun` - Force dry-run mode

### `client.submitEvent(envelope)`

Submit an event envelope to the execution plane.

### `client.requestJob(jobType, inputs, tenantId, projectId, traceId, idempotencyKey?)`

Request a job execution from a template.

### `client.getRunStatus(runId, tenantId?)`

Get the current status of a run.

### `client.getRunManifest(runId, tenantId?)`

Get the artifact manifest for a completed run.

### `client.listArtifacts(runId, tenantId?)`

List all artifacts produced by a run.

### `client.isEnabled()`

Check if integration is enabled.

### `client.isDryRun()`

Check if running in dry-run mode.

### `client.getFeatureFlags()`

Get feature flag summary.

## Error Handling

All errors are instances of `JobForgeClientError`:

```typescript
import { JobForgeClientError } from '@jobforge/client'

try {
  await client.requestJob(...)
} catch (error) {
  if (error instanceof JobForgeClientError) {
    console.log(`Error code: ${error.code}`)
    console.log(`Message: ${error.message}`)
  }
}
```

Error codes:

- `INTEGRATION_DISABLED` - Integration not enabled
- `VALIDATION_ERROR` - Invalid input parameters
- `TRANSPORT_ERROR` - Network or transport failure
- `NOT_FOUND` - Resource not found
- `PERMISSION_DENIED` - Access denied
- `RATE_LIMITED` - Rate limit exceeded
- `INTERNAL_ERROR` - Internal server error

## Development

```bash
# Install dependencies
pnpm install

# Run linting
pnpm lint

# Run type check
pnpm typecheck

# Run tests
pnpm test

# Build
pnpm build

# Run smoke test
pnpm smoke
```

## License

Private - JobForge internal use
