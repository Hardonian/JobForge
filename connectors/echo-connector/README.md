# Echo Connector

A reference connector that echoes its input payload. Useful for testing the connector harness and as a template for building new connectors.

## Usage

```typescript
import { runConnector } from '@jobforge/shared'

const result = await runConnector(echoConnector, {
  config: {
    connector_id: 'echo-connector',
    auth_type: 'none',
    settings: { delay_ms: 0 },
    retry_policy: {
      max_retries: 3,
      base_delay_ms: 1000,
      max_delay_ms: 30000,
      backoff_multiplier: 2,
    },
    timeout_ms: 5000,
  },
  input: {
    operation: 'echo',
    payload: { message: 'hello' },
  },
  context: {
    trace_id: 'trace-001',
    tenant_id: '<your-tenant-uuid>',
    dry_run: false,
    attempt_no: 1,
  },
})
```

## Example

**Input:**

```json
{ "operation": "echo", "payload": { "message": "hello world" } }
```

**Output:**

```json
{ "ok": true, "data": { "echo": { "message": "hello world" } } }
```

## Supported Operations

| Operation      | Description                          |
| -------------- | ------------------------------------ |
| `echo`         | Immediately echoes the payload       |
| `echo.delayed` | Echoes after `delay_ms` milliseconds |

## Configuration

| Field      | Type   | Required | Default | Description               |
| ---------- | ------ | -------- | ------- | ------------------------- |
| `delay_ms` | number | No       | 0       | Delay before echoing (ms) |
