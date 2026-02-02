# @jobforge/observability

Observability layer for JobForge providing structured logging, trace correlation, log redaction, and error normalization.

## Features

- **Structured JSON Logging** - Consistent log format across all services
- **Trace ID Correlation** - Follow requests across service boundaries
- **Log Redaction** - Automatic removal of secrets and PII
- **Error Normalization** - Safe error logging without secret leakage
- **Request/Job Spans** - Lightweight boundary tracking without external deps
- **Feature Flag Control** - Enable with `OBS_ENABLED=1`

## Installation

```bash
pnpm add @jobforge/observability
```

## Quick Start

```typescript
import { ObservabilityLogger, withSpan, redactLogObject } from '@jobforge/observability'

// Create a logger
const logger = new ObservabilityLogger({ service: 'settler' })

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

## API

### ObservabilityLogger

Structured logger with consistent fields:

```typescript
const logger = new ObservabilityLogger({
  service: 'settler',           // Required: service identifier
  env: 'production',            // Optional: auto-detected
  defaultContext: { ... },      // Optional: default fields
  enableRedaction: true,        // Optional: default true
})

// Child logger inherits context
const childLogger = logger.child({ trace_id: '...', tenant_id: '...' })

// Logging methods
logger.debug('Debug message', { extra: 'data' })
logger.info('Info message', { event_type: 'job.started' })
logger.warn('Warning', { ... })
logger.error('Error', { error: normalizedError })

// Log with timing
logger.logWithTiming('info', 'Operation complete', 150, { ... })

// Log errors safely
logger.logError('Failed', error, { ... })
```

### Span Tracking

Lightweight request/job boundary spans:

```typescript
import { withSpan, createRequestSpan, createJobSpan } from '@jobforge/observability'

// Wrap an operation in a span
const result = await withSpan(
  { traceId: 'uuid', spanName: 'process-contract', service: 'settler' },
  async (span) => {
    span.getLogger().info('Processing...')
    return await processContract()
  }
)

// Create spans manually
const span = createRequestSpan({
  traceId: 'uuid',
  service: 'settler',
  requestPath: '/api/contracts',
  requestMethod: 'POST',
  tenantId: 'tenant-uuid',
})

try {
  const result = await handler()
  span.end('ok')
} catch (error) {
  span.end('error', error)
  throw error
}
```

### Log Redaction

Automatic removal of sensitive data:

```typescript
import { redactLogObject, redactHeaders, redactUrl } from '@jobforge/observability'

// Redact objects
const safe = redactLogObject({
  user_id: '123',
  api_key: 'secret',
  password: 'hidden',
  nested: { token: 'jwt' },
})
// Result: { user_id: '123', api_key: '[REDACTED]', password: '[REDACTED]', nested: { token: '[REDACTED]' } }

// Redact headers
const safeHeaders = redactHeaders({
  'Content-Type': 'application/json',
  Authorization: 'Bearer secret',
  Cookie: 'session=abc',
})
// Result: { 'Content-Type': 'application/json', 'Authorization': '[REDACTED:AUTH]', 'Cookie': '[REDACTED:COOKIE]' }

// Redact URLs
const safeUrl = redactUrl('https://api.com?api_key=secret&user=john')
// Result: 'https://api.com?api_key=[REDACTED]&user=john'
```

### Error Normalization

Safe error logging:

```typescript
import { normalizeError, ErrorCodes } from '@jobforge/observability'

try {
  await riskyOperation()
} catch (error) {
  const normalized = normalizeError(error)
  // {
  //   code: 'INTERNAL_ERROR',
  //   message: 'Safe message without secrets',
  //   type: 'Error',
  //   correlation_id: 'uuid-for-debugging'
  // }
  logger.error('Operation failed', { error: normalized })
}
```

## Log Format

All logs are JSON-formatted with these fields:

```json
{
  "timestamp": "2026-02-02T12:34:56.789Z",
  "level": "info",
  "service": "settler",
  "env": "production",
  "trace_id": "uuid-v4",
  "tenant_id": "tenant-uuid",
  "project_id": "project-uuid",
  "actor_id": "user-uuid",
  "event_type": "job.started",
  "run_id": "run-uuid",
  "message": "Human-readable description",
  "duration_ms": 123,
  "error": {
    "code": "ERROR_CODE",
    "message": "Safe message",
    "type": "ErrorType",
    "correlation_id": "debug-uuid"
  }
}
```

## Environment Variables

| Variable            | Default | Description                                   |
| ------------------- | ------- | --------------------------------------------- |
| `OBS_ENABLED`       | `0`     | Enable observability features                 |
| `OBS_DEBUG`         | `0`     | Enable debug logging                          |
| `SERVICE_NAME`      | `''`    | Override service name                         |
| `ENV`               | `local` | Environment name                              |
| `OBS_REDACT_FIELDS` | `''`    | Additional fields to redact (comma-separated) |

## Testing

Run the trace continuity smoke test:

```bash
pnpm test:observability
```

This verifies:

- Trace ID continuity across services
- Log redaction of secrets
- Error normalization
- Span timing tracking

## Integration

See the [Observability Contract](../../docs/OBSERVABILITY_CONTRACT.md) for the complete specification.
