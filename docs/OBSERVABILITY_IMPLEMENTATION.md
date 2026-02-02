# Observability Implementation Summary

This document provides implementation diffs for adding observability to Settler, ReadyLayer, Keys, AIAS, and JobForge services.

## Files Created

### 1. Observability Package (`packages/observability/`)

- **New Package**: `@jobforge/observability`
- **Purpose**: Shared observability layer for all services
- **Location**: `packages/observability/`

**Files:**

- `src/index.ts` - Main exports
- `src/logger.ts` - `ObservabilityLogger` with structured JSON logging
- `src/redaction.ts` - Log redaction utilities (`redactLogObject`, `redactHeaders`, `redactUrl`)
- `src/span.ts` - Lightweight span tracking (`withSpan`, `createRequestSpan`, `createJobSpan`)
- `src/errors.ts` - Error normalization (`normalizeError`, `ErrorCodes`)
- `src/feature-flags.ts` - `OBS_ENABLED` feature flag
- `test/trace-continuity.test.ts` - Cross-service trace continuity smoke test
- `README.md` - Package documentation

### 2. Observability Contract Document

- **Location**: `docs/OBSERVABILITY_CONTRACT.md`
- **Purpose**: Complete specification for the observability layer

### 3. Feature Flag Updates

- **File**: `packages/shared/src/feature-flags.ts`
- **Change**: Added `OBS_ENABLED` export

## Per-Repo Implementation

### JobForge Core (Already Implemented)

The worker already uses structured logging. To align with the new observability contract:

**File**: `services/worker-ts/src/lib/logger.ts`

```typescript
// BEFORE: Existing logger
class Logger { ... }

// AFTER: Import from observability package
import { ObservabilityLogger } from '@jobforge/observability'

// Re-export for backwards compatibility
export { ObservabilityLogger as Logger }
export type { LogContext } from '@jobforge/observability'
```

**File**: `services/worker-ts/src/lib/worker.ts`

```typescript
// Add observability context to job processing
const jobLogger = logger.child({
  trace_id: traceContext.trace_id,
  tenant_id: job.tenant_id,
  job_id: job.id,
  job_type: job.type,
  worker_id: this.workerId,
  event_type: 'job.started',
})

// Log job completion with timing
jobLogger.logWithTiming('info', 'Job completed successfully', durationMs, {
  event_type: 'job.completed',
})
```

### Settler Adapter

**File**: `packages/adapters/settler/src/index.ts`

```typescript
// Add observability imports
import { ObservabilityLogger, withSpan, redactLogObject } from '@jobforge/observability'

// Add to SettlerAdapter class
export class SettlerAdapter extends JobForgeAdapter {
  private logger: ObservabilityLogger

  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({ app: 'settler', tenantId, projectId, client })

    // Initialize logger with service context
    this.logger = new ObservabilityLogger({
      service: 'settler',
      defaultContext: {
        tenant_id: this.getConfig().tenantId,
        project_id: this.getConfig().projectId,
      },
    })
  }

  // Update submitContractEvent with observability
  async submitContractEvent(
    eventType: 'contract.created' | 'contract.updated' | 'contract.executed' | 'contract.expiring',
    payload: { contract_id: string; [key: string]: unknown },
    traceId?: string
  ) {
    return withSpan(
      {
        traceId: traceId || generateTraceId(),
        spanName: `event:${eventType}`,
        service: 'settler',
        tenantId: this.getConfig().tenantId,
        projectId: this.getConfig().projectId,
        additionalContext: { event_type: 'adapter.event.submitted' },
      },
      async (span) => {
        span.getLogger().info(`Submitting contract event: ${eventType}`, {
          contract_id: payload.contract_id,
          event_type: `settler.${eventType}`,
          // Redact any sensitive payload data
          payload_summary: redactLogObject(payload),
        })

        return this.submitEvent({
          eventType: `settler.${eventType}`,
          payload,
          traceId: span.getContext().trace_id,
          module: 'core',
          subjectType: 'contract',
          subjectId: payload.contract_id,
        })
      }
    )
  }
}
```

### ReadyLayer Adapter

**File**: `packages/adapters/readylayer/src/index.ts`

```typescript
// Add observability imports
import {
  ObservabilityLogger,
  withSpan,
  redactLogObject
} from '@jobforge/observability'

// Similar pattern to SettlerAdapter
export class ReadyLayerAdapter extends JobForgeAdapter {
  private logger: ObservabilityLogger

  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({ app: 'readylayer', tenantId, projectId, client })
    this.logger = new ObservabilityLogger({
      service: 'readylayer',
      defaultContext: {
        tenant_id: this.getConfig().tenantId,
        project_id: this.getConfig().projectId,
      }
    })
  }

  // Example: Asset optimization with observability
  async requestAssetOptimization(
    assetId: string,
    sourceUrl: string,
    options?: { formats?: string[]; sizes?: number[]; quality?: number; traceId?: string }
  ) {
    return withSpan(
      {
        traceId: options?.traceId || generateTraceId(),
        spanName: 'job:asset.optimize',
        service: 'readylayer',
        tenantId: this.getConfig().tenantId,
        additionalContext: {
          event_type: 'adapter.job.requested',
          asset_id: assetId
        }
      },
      async (span) => {
        span.getLogger().info('Requesting asset optimization', {
          asset_id: assetId,
          source_url: redactUrl(sourceUrl), // Redact any creds in URL
        })

        return this.requestJob({
          templateKey: 'readylayer.asset.optimize',
          inputs: { ... },
          traceId: span.getContext().trace_id,
        })
      }
    )
  }
}
```

### Keys Adapter

**File**: `packages/adapters/keys/src/index.ts`

```typescript
// Add observability imports
import { ObservabilityLogger, withSpan, redactLogObject } from '@jobforge/observability'

export class KeysAdapter extends JobForgeAdapter {
  private logger: ObservabilityLogger

  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({ app: 'keys', tenantId, projectId, client })
    this.logger = new ObservabilityLogger({
      service: 'keys',
      defaultContext: {
        tenant_id: this.getConfig().tenantId,
        project_id: this.getConfig().projectId,
      },
    })
  }

  // Example: Key event with observability
  async submitKeyEvent(
    eventType: 'key.created' | 'key.rotated' | 'key.revoked' | 'key.quota_exceeded',
    payload: { key_id: string; [key: string]: unknown },
    traceId?: string
  ) {
    return withSpan(
      {
        traceId: traceId || generateTraceId(),
        spanName: `event:${eventType}`,
        service: 'keys',
        tenantId: this.getConfig().tenantId,
        additionalContext: { event_type: 'adapter.event.submitted' },
      },
      async (span) => {
        // NEVER log key values - even in redacted form
        span.getLogger().info(`Key event: ${eventType}`, {
          key_id: payload.key_id,
          event_type: `keys.${eventType}`,
          // Only log non-sensitive metadata
          metadata: redactLogObject({
            key_id: payload.key_id,
            tenant_id: this.getConfig().tenantId,
            // Any other non-sensitive fields
          }),
        })

        return this.submitEvent({
          eventType: `keys.${eventType}`,
          payload, // Payload sent to execution plane
          traceId: span.getContext().trace_id,
          module: 'core',
          subjectType: 'api_key',
          subjectId: payload.key_id,
        })
      }
    )
  }
}
```

### AIAS Adapter

**File**: `packages/adapters/aias/src/index.ts`

```typescript
// Add observability imports
import { ObservabilityLogger, withSpan, redactLogObject } from '@jobforge/observability'

export class AiasAdapter extends JobForgeAdapter {
  private logger: ObservabilityLogger

  constructor(tenantId?: string, projectId?: string, client?: JobForgeClient) {
    super({ app: 'aias', tenantId, projectId, client })
    this.logger = new ObservabilityLogger({
      service: 'aias',
      defaultContext: {
        tenant_id: this.getConfig().tenantId,
        project_id: this.getConfig().projectId,
      },
    })
  }

  // Example: Agent execution with observability
  async requestAgentExecution(
    agentId: string,
    inputData: Record<string, unknown>,
    options?: {
      model?: string
      maxTokens?: number
      temperature?: number
      tools?: string[]
      traceId?: string
    }
  ) {
    return withSpan(
      {
        traceId: options?.traceId || generateTraceId(),
        spanName: 'job:agent.execute',
        service: 'aias',
        tenantId: this.getConfig().tenantId,
        additionalContext: {
          event_type: 'adapter.job.requested',
          agent_id: agentId,
          model: options?.model || 'gpt-4',
        },
      },
      async (span) => {
        span.getLogger().info('Requesting agent execution', {
          agent_id: agentId,
          model: options?.model || 'gpt-4',
          // Redact any sensitive input data
          input_summary: redactLogObject(inputData),
        })

        return this.requestJob({
          templateKey: 'aias.agent.execute',
          inputs: {
            agent_id: agentId,
            tenant_id: this.getConfig().tenantId,
            input_data: inputData,
            model: options?.model || 'gpt-4',
            max_tokens: options?.maxTokens || 4096,
            temperature: options?.temperature || 0.7,
            tools: options?.tools,
          },
          traceId: span.getContext().trace_id,
        })
      }
    )
  }
}
```

## Environment Configuration

Add these environment variables to each service:

```bash
# Enable observability
OBS_ENABLED=1

# Service identification (optional, auto-detected)
SERVICE_NAME=settler  # or readylayer, keys, aias, jobforge

# Environment
ENV=production  # or local, dev, staging

# Optional: Additional redaction fields (comma-separated)
OBS_REDACT_FIELDS=custom_secret_field,another_sensitive_key

# Optional: Debug logging
OBS_DEBUG=1
```

## Running the Smoke Test

To verify cross-service trace continuity:

```bash
# Run the observability smoke test
pnpm test:observability

# Expected output:
# ✓ Trace continuity verified across X log entries
# ✓ Services: settler, readylayer, keys, aias, jobforge
# ✓ Log redaction verified
# ✓ Error normalization verified
```

## Log Output Examples

### Structured JSON (Production)

```json
{
  "timestamp": "2026-02-02T12:34:56.789Z",
  "level": "info",
  "service": "settler",
  "env": "production",
  "trace_id": "550e8400-e29b-41d4-a716-446655440000",
  "tenant_id": "123e4567-e89b-12d3-a456-426614174000",
  "project_id": "987fcdeb-51a2-43f7-9876-543210987000",
  "actor_id": "user-123",
  "event_type": "adapter.event.submitted",
  "span_name": "event:contract.created",
  "message": "Submitting contract event: contract.created",
  "contract_id": "contract-456",
  "duration_ms": 45
}
```

### Pretty-Printed (Local Development)

```
[2026-02-02T12:34:56.789Z] INFO [settler] Submitting contract event: contract.created trace_id=550e8400-e29b-41d4-a716-446655440000 tenant_id=123e4567-e89b-12d3-a456-426614174000 contract_id=contract-456
```

## Migration Checklist

- [ ] Install `@jobforge/observability` package in each service
- [ ] Add `OBS_ENABLED=1` to environment configuration
- [ ] Update adapter constructors to initialize `ObservabilityLogger`
- [ ] Wrap event submission methods with `withSpan`
- [ ] Add `redactLogObject()` to all log calls with user data
- [ ] Use `redactUrl()` for logging URLs that may contain credentials
- [ ] Verify trace continuity with smoke test
- [ ] Run full build and test suite
- [ ] Update documentation

## Backwards Compatibility

The observability layer is fully backwards compatible:

1. **Default Disabled**: `OBS_ENABLED=0` by default
2. **No Breaking Changes**: Existing `console.log` calls continue to work
3. **Gradual Migration**: Services can enable observability independently
4. **Safe Defaults**: Redaction is enabled by default to prevent secret leakage
