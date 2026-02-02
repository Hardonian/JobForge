# Security and Safety Guide

**Version**: 1.0.0  
**Date**: 2026-02-02

This guide covers security controls, safety mechanisms, and emergency procedures for the JobForge runnerless execution plane.

---

## Safe-by-Default Architecture

All execution plane features are **disabled by default**. This ensures zero side effects until explicitly enabled.

### Feature Flag Defaults

| Flag                                   | Default | Description         | Risk Level |
| -------------------------------------- | ------- | ------------------- | ---------- |
| `JOBFORGE_EVENTS_ENABLED`              | `0`     | Event ingestion     | Low        |
| `JOBFORGE_TRIGGERS_ENABLED`            | `0`     | Scheduling triggers | Medium     |
| `JOBFORGE_AUTOPILOT_JOBS_ENABLED`      | `0`     | Autopilot templates | Medium     |
| `JOBFORGE_ACTION_JOBS_ENABLED`         | `0`     | Write operations    | **High**   |
| `JOBFORGE_MANIFESTS_ENABLED`           | `0`     | Artifact manifests  | Low        |
| `JOBFORGE_AUDIT_LOGGING_ENABLED`       | `0`     | Audit trail         | Low        |
| `VERIFY_PACK_ENABLED`                  | `0`     | Verify pack jobs    | Medium     |
| `REPLAY_PACK_ENABLED`                  | `0`     | Replay bundles      | Low        |
| `JOBFORGE_SECURITY_VALIDATION_ENABLED` | `1`     | Payload validation  | N/A        |
| `JOBFORGE_REQUIRE_POLICY_TOKENS`       | `1`     | Token enforcement   | N/A        |

**Security Principle**: Defense in depth through progressive enablement.

---

## Emergency Rollback

### Instant Disable (All Features)

```bash
# Method 1: Unset all flags
unset JOBFORGE_EVENTS_ENABLED \
      JOBFORGE_TRIGGERS_ENABLED \
      JOBFORGE_AUTOPILOT_JOBS_ENABLED \
      JOBFORGE_ACTION_JOBS_ENABLED \
      JOBFORGE_MANIFESTS_ENABLED \
      JOBFORGE_AUDIT_LOGGING_ENABLED \
      VERIFY_PACK_ENABLED \
      REPLAY_PACK_ENABLED

# Method 2: Set all to 0
export JOBFORGE_EVENTS_ENABLED=0
export JOBFORGE_TRIGGERS_ENABLED=0
export JOBFORGE_AUTOPILOT_JOBS_ENABLED=0
export JOBFORGE_ACTION_JOBS_ENABLED=0
export JOBFORGE_MANIFESTS_ENABLED=0
export VERIFY_PACK_ENABLED=0
export REPLAY_PACK_ENABLED=0
```

**Effect**: Immediate. No restart required. All execution plane features become no-ops.

### Verification

```bash
# Check current state
pnpm ts-node scripts/smoke-test-final.ts

# Expected output with flags OFF:
# ✓ Safe to deploy: All execution plane features are OFF by default
```

---

## Policy Token Security

### Action Job Authorization

Action jobs (write operations) require HMAC-signed policy tokens.

```typescript
import { generatePolicyToken } from '@jobforge/shared'

const token = generatePolicyToken({
  tenantId: 'tenant-123',
  actorId: 'user-abc',
  action: 'autopilot.ops.apply',
  scopes: ['ops:write'],
  expiresInHours: 1,
})
```

### Required Configuration

| Environment Variable                 | Required For   | Format                    |
| ------------------------------------ | -------------- | ------------------------- |
| `JOBFORGE_POLICY_TOKEN_SECRET`       | Action jobs    | Min 32 chars, random      |
| `JOBFORGE_POLICY_TOKEN_EXPIRY_HOURS` | Token lifetime | Integer (default: 1)      |
| `JOBFORGE_REQUIRE_POLICY_TOKENS`     | Enforcement    | `0` or `1` (default: `1`) |

**Safety Check**: System throws on startup if:

- `JOBFORGE_ACTION_JOBS_ENABLED=1` AND
- `JOBFORGE_REQUIRE_POLICY_TOKENS=1` AND
- `JOBFORGE_POLICY_TOKEN_SECRET` is empty

### Scope Requirements

| Template                     | Required Scope |
| ---------------------------- | -------------- |
| `autopilot.ops.scan`         | `ops:read`     |
| `autopilot.ops.apply`        | `ops:write`    |
| `autopilot.support.triage`   | `support:read` |
| `autopilot.finops.reconcile` | `finops:write` |
| `readylayer.verify_pack`     | `ops:read`     |

---

## Tenant Isolation

### Row Level Security (RLS)

All execution plane tables enforce tenant isolation:

```sql
-- Example RLS policy
CREATE POLICY tenant_isolation ON jobforge_events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
```

### Verification

```bash
# Run RLS isolation test
psql -U postgres -d jobforge -f supabase/tests/test_rls_isolation.sql
```

### Multi-Tenant Safety

- **No cross-tenant access**: RLS policies block all cross-tenant queries
- **Tenant context required**: All RPC functions require `tenant_id`
- **Service role bypass**: Only for admin operations, never exposed to tenants

---

## Input Validation

### Payload Security

```typescript
import { validatePayload } from '@jobforge/shared'

const result = validatePayload(payload, {
  maxSizeBytes: 1024 * 1024, // 1MB limit
  maxDepth: 10,
  allowLists: false,
})

if (!result.valid) {
  throw new Error(`Invalid payload: ${result.errors.join(', ')}`)
}
```

### SSRF Protection

HTTP connector blocks private IPs:

```typescript
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '169.254.169.254', // AWS metadata
  'metadata.google.internal',
]
```

---

## Audit Logging

### Actions Logged

| Action            | Logged Fields                                          |
| ----------------- | ------------------------------------------------------ |
| Event submission  | `event_type`, `tenant_id`, `trace_id`, `actor_id`      |
| Job request       | `template_key`, `tenant_id`, `inputs_hash`, `actor_id` |
| Policy token use  | `action`, `scopes`, `tenant_id`, `actor_id`            |
| Manifest creation | `run_id`, `job_type`, `tenant_id`                      |

### Retention

Default: 90 days

Configure via:

```sql
-- Set retention per tenant
SELECT jobforge_set_audit_retention('tenant-123', 30);
```

---

## Rate Limiting

### Per-Tenant Limits

| Resource               | Default Limit |
| ---------------------- | ------------- |
| Events per minute      | 1000          |
| Jobs per minute        | 100           |
| Policy tokens per hour | 50            |

Override via:

```bash
export JOBFORGE_RATE_LIMIT_EVENTS_PER_MIN=500
export JOBFORGE_RATE_LIMIT_JOBS_PER_MIN=50
```

---

## Secrets Management

### Never in Database

```typescript
// ❌ WRONG
await db.insert('configs', { secret: 'actual-value' })

// ✅ CORRECT
const secret = process.env.WEBHOOK_SECRET_TENANT_123
```

### Required Secrets

| Secret                         | Purpose         | Rotation  |
| ------------------------------ | --------------- | --------- |
| `SUPABASE_SERVICE_ROLE_KEY`    | Database access | Quarterly |
| `JOBFORGE_POLICY_TOKEN_SECRET` | Token signing   | Monthly   |
| `WEBHOOK_SIGNING_SECRET`       | Webhook HMAC    | Monthly   |

---

## Dry-Run Mode

### Safe Testing

All job requests support `dry_run` mode:

```typescript
const result = await client.requestJob({
  tenant_id: 'tenant-123',
  template_key: 'autopilot.ops.apply',
  inputs: { ... },
  dry_run: true, // No side effects
})
```

**Dry-run behavior**:

- Validates inputs
- Checks policy tokens
- Logs audit entry (marked as dry_run)
- Does NOT create actual job
- Does NOT execute side effects

---

## Incident Response

### Severity Levels

| Level | Criteria                          | Response                       |
| ----- | --------------------------------- | ------------------------------ |
| P0    | Unauthorized action job execution | Disable all flags immediately  |
| P1    | Cross-tenant data access          | Isolate tenant, disable events |
| P2    | Rate limit bypass                 | Enable stricter limits         |
| P3    | Audit log gap                     | Investigate, patch             |

### Response Playbook

1. **Disable** (30 seconds)

   ```bash
   export JOBFORGE_ACTION_JOBS_ENABLED=0
   export JOBFORGE_EVENTS_ENABLED=0
   ```

2. **Verify** (1 minute)

   ```bash
   pnpm ts-node scripts/smoke-test-final.ts
   ```

3. **Assess** (5 minutes)
   - Check audit logs: `SELECT * FROM jobforge_audit_logs WHERE ...`
   - Review job queue: `SELECT * FROM jobforge_jobs WHERE ...`

4. **Restore** (when safe)
   - Re-enable features one by one
   - Monitor smoke test output

---

## Compliance

### Data Retention

| Data Type      | Default Retention | Configurable |
| -------------- | ----------------- | ------------ |
| Events         | 90 days           | Yes          |
| Jobs           | 90 days           | Yes          |
| Audit logs     | 1 year            | Yes          |
| Manifests      | 90 days           | Yes          |
| Replay bundles | 30 days           | Yes          |

### GDPR

Right to deletion:

```sql
-- Delete all tenant data
DELETE FROM jobforge_events WHERE tenant_id = 'tenant-to-delete';
DELETE FROM jobforge_jobs WHERE tenant_id = 'tenant-to-delete';
DELETE FROM jobforge_audit_logs WHERE tenant_id = 'tenant-to-delete';
```

---

## Security Checklist

### Pre-Deployment

- [ ] All feature flags default to `0`
- [ ] Policy token secret is set (min 32 chars)
- [ ] RLS enabled on all execution plane tables
- [ ] Audit logging configured
- [ ] Rate limits set appropriately
- [ ] Secrets NOT stored in database
- [ ] SSRF protection enabled
- [ ] Input validation configured

### Post-Deployment

- [ ] Smoke test passes with flags OFF
- [ ] Smoke test passes with flags ON (local only)
- [ ] RLS isolation verified
- [ ] Policy tokens validated
- [ ] Audit logs recording
- [ ] Rate limits enforced

### Ongoing

- [ ] Rotate secrets monthly
- [ ] Review audit logs weekly
- [ ] Run smoke test in CI
- [ ] Update policy token secret quarterly

---

## Contacts

| Role             | Contact              | Escalation       |
| ---------------- | -------------------- | ---------------- |
| Security Team    | security@example.com | +1-555-SECURITY  |
| On-Call Engineer | oncall@example.com   | PagerDuty        |
| Engineering Lead | eng-lead@example.com | Slack #incidents |

---

For operational procedures, see [RUNBOOK.md](RUNBOOK.md).  
For architecture details, see [ARCHITECTURE.md](ARCHITECTURE.md).
