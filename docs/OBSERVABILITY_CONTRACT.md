# JobForge Observability Contract

**Version:** 1.0.0  
**Applies to:** Settler, ReadyLayer, Keys, AIAS, and JobForge Core  
**Feature Flag:** `OBS_ENABLED=1` (default: disabled)

---

## 1. Overview

This document defines the minimal, consistent observability layer across all JobForge-integrated services. It ensures:

- **Structured logging** (JSON format)
- **Trace correlation** (trace_id continuity across services)
- **Request/job boundary spans** (lightweight, no external deps)
- **Automatic redaction** (PII/sensitive data defaults)
- **Error normalization** (no secrets in logs)
- **Consistent log fields** across all services

---

## 2. Log Format

All logs MUST be JSON-formatted with the following structure:

```json
{
  "timestamp": "2026-02-02T12:34:56.789Z",
  "level": "info|warn|error|debug",
  "service": "settler|readylayer|keys|aias|jobforge",
  "env": "local|dev|staging|production",
  "trace_id": "uuid-v4-string",
  "tenant_id": "uuid-v4-string",
  "project_id": "optional-project-uuid",
  "actor_id": "optional-user-or-system-id",
  "event_type": "job.started|job.completed|request.inbound|etc",
  "run_id": "optional-run-uuid",
  "message": "Human-readable log message",
  "duration_ms": 123,
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe error message (no secrets)",
    "type": "ValidationError|NetworkError|etc"
  }
}
```

### Required Fields

| Field       | Type    | Description                            |
| ----------- | ------- | -------------------------------------- |
| `timestamp` | ISO8601 | UTC timestamp                          |
| `level`     | string  | Log level: debug, info, warn, error    |
| `service`   | string  | Service identifier                     |
| `env`       | string  | Environment name                       |
| `trace_id`  | UUID    | Correlation ID for distributed tracing |
| `message`   | string  | Human-readable description             |

### Optional Fields

| Field         | Type   | When to Include                 |
| ------------- | ------ | ------------------------------- |
| `tenant_id`   | UUID   | Multi-tenant operations         |
| `project_id`  | UUID   | Project-scoped operations       |
| `actor_id`    | string | User or system actor            |
| `event_type`  | string | Structured event categorization |
| `run_id`      | UUID   | Job execution run identifier    |
| `duration_ms` | number | Operation timing                |
| `error`       | object | Normalized error details        |

---

## 3. Service Identifiers

Use these exact service names in the `service` field:

- `settler` - Contract management platform
- `readylayer` - Content delivery/CDN platform
- `keys` - API key management platform
- `aias` - AI Agent System
- `jobforge` - Job execution core

---

## 4. Environment Names

Standard environment identifiers:

- `local` - Local development
- `dev` - Development deployments
- `staging` - Staging/pre-production
- `production` - Production environment

**Detection Priority:**

1. `ENV` environment variable
2. `NODE_ENV` environment variable
3. `VERCEL_ENV` environment variable
4. Default: `local`

---

## 5. Event Types

Standard event types for consistency:

### Job Events

- `job.started` - Job processing began
- `job.completed` - Job finished successfully
- `job.failed` - Job failed (will retry)
- `job.dead` - Job failed permanently
- `job.claimed` - Job claimed by worker
- `job.heartbeat` - Job heartbeat update

### Request Events

- `request.inbound` - Incoming HTTP request
- `request.outbound` - Outgoing HTTP request
- `request.completed` - Request completed
- `request.failed` - Request failed

### Adapter Events

- `adapter.event.submitted` - Event submitted to execution plane
- `adapter.job.requested` - Job requested via adapter
- `adapter.manifest.fetched` - Run manifest retrieved

---

## 6. Trace ID Propagation

Trace IDs flow through the system as follows:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Settler   │────▶│  JobForge   │────▶│   Worker    │────▶│  Adapter    │
│   (App)     │     │  (Event)    │     │  (Process)  │     │  (Manifest) │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │                   │
       │            Same trace_id              │            Same trace_id
       │◄──────────────────────────────────────┘◄──────────────────┘
```

### Propagation Methods

1. **HTTP Headers**: `x-trace-id` header
2. **Job Payload**: `_trace_context` field in job payload
3. **AsyncLocalStorage**: Node.js context propagation (when available)

### Code Example

```typescript
// Extract trace from incoming request
const traceId = extractTraceFromHeaders(headers) || generateTraceId()

// Propagate to job
await adapter.requestJob({
  templateKey: 'settler.contract.process',
  inputs: { contract_id: '...' },
  traceId, // Same trace continues
})

// Worker receives trace in context
const jobLogger = logger.child({
  trace_id: context.trace_id, // Continues original trace
  job_id: job.id,
})
```

---

## 7. Log Redaction

All sensitive fields MUST be redacted by default.

### Auto-Redacted Fields

| Pattern                     | Redaction           |
| --------------------------- | ------------------- |
| `password`, `passwd`        | `[REDACTED]`        |
| `secret`, `api_key`         | `[REDACTED]`        |
| `token`, `auth_token`       | `[REDACTED]`        |
| `credential`, `credentials` | `[REDACTED]`        |
| `private_key`, `privateKey` | `[REDACTED:KEY]`    |
| `credit_card`, `ssn`        | `[REDACTED:PII]`    |
| `Authorization` header      | `[REDACTED:AUTH]`   |
| `Cookie` header             | `[REDACTED:COOKIE]` |

### Redaction Levels

- `[REDACTED]` - Standard redaction
- `[REDACTED:KEY]` - Cryptographic key
- `[REDACTED:PII]` - Personal identifiable information
- `[REDACTED:AUTH]` - Authentication credential
- `[REDACTED:COOKIE]` - Session cookie

### Usage

```typescript
import { redactLogObject } from '@jobforge/observability'

// Redact an object before logging
const safePayload = redactLogObject({
  user_id: '123',
  api_key: 'sk-abc123',
  password: 'secret123',
  metadata: { token: 'jwt-token-here' },
})
// Result:
// {
//   user_id: '123',
//   api_key: '[REDACTED]',
//   password: '[REDACTED]',
//   metadata: { token: '[REDACTED]' }
// }
```

---

## 8. Error Normalization

Errors MUST be normalized to prevent secret leakage.

### Error Structure

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input: contract_id must be a valid UUID",
    "type": "AppError",
    "correlation_id": "uuid-for-debugging"
  }
}
```

### Rules

1. **Never log stack traces** in production (use correlation_id for lookup)
2. **Never include raw error messages** from external services
3. **Use error codes** for categorization
4. **Include correlation_id** for cross-referencing in error tracking

### Error Codes

| Code                     | Description                 |
| ------------------------ | --------------------------- |
| `VALIDATION_ERROR`       | Input validation failed     |
| `NOT_FOUND`              | Resource not found          |
| `UNAUTHORIZED`           | Authentication required     |
| `FORBIDDEN`              | Permission denied           |
| `RATE_LIMITED`           | Too many requests           |
| `INTERNAL_ERROR`         | Generic internal error      |
| `EXTERNAL_SERVICE_ERROR` | Third-party service failure |
| `TIMEOUT_ERROR`          | Operation timed out         |

---

## 9. Implementation Guide

### For TypeScript Services

```typescript
import { ObservabilityLogger } from '@jobforge/observability'
import { redactLogObject } from '@jobforge/observability'

// Create service-level logger
const logger = new ObservabilityLogger({
  service: 'settler',
  env: process.env.ENV,
})

// Create request-scoped logger with trace context
const requestLogger = logger.child({
  trace_id: 'uuid-here',
  tenant_id: 'tenant-uuid',
  actor_id: 'user-uuid',
})

// Log with automatic redaction
requestLogger.info('Processing contract', {
  contract_id: 'uuid',
  config: redactLogObject({ api_key: 'secret' }),
})
```

### For Adapters

```typescript
import { withObservability } from '@jobforge/observability'

// Wrap adapter methods with observability
class SettlerAdapter extends JobForgeAdapter {
  async requestContractProcessing(contractId: string, traceId?: string) {
    return withObservability(
      { trace_id: traceId, service: 'settler', event_type: 'adapter.job.requested' },
      async () => {
        return this.requestJob({ ... })
      }
    )
  }
}
```

---

## 10. Feature Flag

The observability layer is controlled by the `OBS_ENABLED` feature flag.

### Behavior

| OBS_ENABLED  | Behavior                                  |
| ------------ | ----------------------------------------- |
| `0` or unset | Minimal logging (backwards compatible)    |
| `1`          | Full structured logging with all features |

### Environment Variables

```bash
# Enable observability
OBS_ENABLED=1

# Service identification (auto-detected if not set)
SERVICE_NAME=settler
ENV=production

# Optional: Customize redaction
OBS_REDACT_FIELDS=custom_secret,another_key

# Optional: Enable debug logging
OBS_DEBUG=1
```

---

## 11. Compatibility

### Local Development

- Logs are pretty-printed when `ENV=local`
- Full redaction still applies
- Debug level enabled by default

### Vercel/Serverless

- JSON logs written to stdout (captured by platform)
- AsyncLocalStorage for context propagation
- Cold start optimized (minimal deps)

### Worker Environments

- Structured JSON to stdout
- Child loggers for job context
- Trace propagation via job payload

---

## 12. Migration Path

### Phase 1: Enable Feature Flag

```bash
OBS_ENABLED=1
```

### Phase 2: Update Log Calls

Replace:

```typescript
console.log(`Processing job ${job.id}`)
```

With:

```typescript
logger.info('Processing job', { job_id: job.id, trace_id: context.trace_id })
```

### Phase 3: Add Trace Propagation

Ensure all adapter calls include trace_id:

```typescript
const result = await adapter.requestJob({ traceId: currentTraceId, ... })
```

---

## 13. Validation

Run the smoke test to verify trace continuity:

```bash
# Run cross-service trace test
pnpm test:observability

# Verify build
pnpm build
```

---

## 14. References

- Architecture: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
- Integration: [docs/INTEGRATION_README.md](../docs/INTEGRATION_README.md)
- Security: [docs/SECURITY.md](../docs/SECURITY.md)
