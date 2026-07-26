# Operator status evidence

`pnpm jobforge:status --input jobs.json --out .jobforge/operator-status.json` writes a durable JSON snapshot containing counts by status, every input job, retryable failures, and terminal failures. Input may be an array or `{ "jobs": [...] }`.

Retryability is explicit: a failed job is retryable only while `retryCount < maxRetries`. The report is derived from supplied job evidence and makes no availability or customer claims.
