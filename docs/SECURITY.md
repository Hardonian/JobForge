# JobForge Security Model

This document describes the security guarantees and operational requirements for JobForge.

## 1) Tenant Isolation (RLS)

- **Primary boundary:** Postgres Row Level Security (RLS).
- **Enforcement:** RPC functions + RLS policies prevent cross-tenant reads/writes.
- **Service role keys:** server-only; never expose to browsers or untrusted clients.

## 2) Secrets Management

- **No plaintext secrets in DB.** Store references only (`secret_ref`), resolve via env/secret store.
- **Rotation:** deploy new secret → update references → revoke old secret.

## 3) Webhook Delivery Security

JobForge workers deliver outbound webhooks with payload validation and signing.

### HMAC Signing

- When `secret_ref` is present, workers sign the payload using `sha256` or `sha512`.
- Signature header: `X-JobForge-Signature: <algo>=<hex>`.

### SSRF Protection

Workers reject unsafe webhook targets:

- `localhost`, `*.localhost`, `*.local`, `*.internal`
- Private IP ranges (RFC1918), loopback, link-local, IPv6 local/unique-local

This prevents accidental access to internal metadata endpoints or private networks.

### Replay Protection (Receiver)

Receivers should verify:

- **Signature validity** using the shared secret.
- **Timestamp window** using `X-JobForge-Timestamp` to reject old payloads.
- **Event ID idempotency** by tracking `X-JobForge-Event-ID`.

## 4) Rate Limiting

- `/api/health` is guarded by an **in-memory rate limiter**.
- Default: **60 requests / 60 seconds per client**.
- Configure via:
  - `JOBFORGE_HEALTH_RATE_LIMIT`
  - `JOBFORGE_HEALTH_RATE_WINDOW_MS`

> For production, replace in-memory storage with Redis or another centralized store.

## 5) Input Validation

- **TypeScript:** Zod schemas validate job payloads and connector inputs.
- **Python:** Pydantic models validate worker payloads.

## 6) Observability & Error Handling

- Correlation IDs propagated by middleware (`x-correlation-id`).
- Structured logs for API endpoints include correlation ID, route, status, duration.
- UI error boundaries prevent blank screens.
