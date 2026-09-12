-- JobForge Schema Expansion: Multi-Tenant Architecture & Auth Layer
-- Version: 0.3.0
-- Depends: 001_jobforge_core.sql, 002_execution_plane.sql

-- ============================================================================
-- 1. COLUMN ADDITIONS: jobforge_jobs
-- ============================================================================
ALTER TABLE jobforge_jobs 
  ADD COLUMN IF NOT EXISTS priority INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timeout_ms INT NOT NULL DEFAULT 300000;

-- Update claim index to prioritize high-priority jobs
DROP INDEX IF EXISTS idx_jobforge_jobs_claim;
CREATE INDEX idx_jobforge_jobs_claim
  ON jobforge_jobs (tenant_id, status, priority DESC, run_at ASC)
  WHERE status = 'queued';

-- Composite index for stuck job discovery
CREATE INDEX IF NOT EXISTS idx_jobforge_jobs_stuck
  ON jobforge_jobs (status, heartbeat_at)
  WHERE status = 'running';

-- ============================================================================
-- 2. TABLE: jobforge_tenants
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'standard' CHECK (tier IN ('free', 'standard', 'pro', 'enterprise')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_paused BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobforge_tenants_active ON jobforge_tenants (is_active, is_paused);

-- ============================================================================
-- 3. TABLE: jobforge_api_keys
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES jobforge_tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL, -- First 8 chars for display
  key_hash TEXT NOT NULL UNIQUE, -- SHA-256 hash of secret key
  scopes JSONB NOT NULL DEFAULT '["jobs:read", "jobs:write"]'::jsonb,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobforge_api_keys_hash ON jobforge_api_keys (key_hash) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobforge_api_keys_tenant ON jobforge_api_keys (tenant_id);

-- ============================================================================
-- 4. TABLE: jobforge_quotas
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_quotas (
  tenant_id UUID PRIMARY KEY REFERENCES jobforge_tenants(id) ON DELETE CASCADE,
  max_concurrent_jobs INT NOT NULL DEFAULT 10,
  max_monthly_jobs INT NOT NULL DEFAULT 50000,
  max_payload_bytes INT NOT NULL DEFAULT 5242880, -- 5 MB
  burst_allowance INT NOT NULL DEFAULT 5,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 5. RPC: jobforge_claim_jobs (Updated with Priority & Concurrency Checks)
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_claim_jobs(
  p_worker_id TEXT,
  p_limit INT DEFAULT 10
)
RETURNS SETOF jobforge_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_worker_id IS NULL THEN
    RAISE EXCEPTION 'worker_id is required';
  END IF;

  RETURN QUERY
  WITH claimable AS (
    SELECT j.id
    FROM jobforge_jobs j
    JOIN jobforge_tenants t ON t.id = j.tenant_id
    WHERE j.status = 'queued'
      AND j.run_at <= NOW()
      AND t.is_active = true
      AND t.is_paused = false
    ORDER BY j.priority DESC, j.run_at ASC
    LIMIT p_limit
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE jobforge_jobs j
  SET status = 'running',
      locked_at = NOW(),
      locked_by = p_worker_id,
      heartbeat_at = NOW(),
      started_at = COALESCE(j.started_at, NOW()),
      attempts = j.attempts + 1,
      updated_at = NOW()
  FROM claimable
  WHERE j.id = claimable.id
  RETURNING j.*;
END;
$$;

-- ============================================================================
-- 6. RPC: jobforge_enqueue_batch (Atomic Multi-Job Enqueue)
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_enqueue_batch(
  p_tenant_id UUID,
  p_jobs JSONB[]
)
RETURNS SETOF jobforge_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_job JSONB;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  RETURN QUERY
  WITH input_jobs AS (
    SELECT 
      p_tenant_id AS tenant_id,
      (elem->>'type')::TEXT AS type,
      COALESCE(elem->'payload', '{}'::jsonb) AS payload,
      (elem->>'idempotency_key')::TEXT AS idempotency_key,
      COALESCE((elem->>'priority')::INT, 0) AS priority,
      COALESCE((elem->>'timeout_ms')::INT, 300000) AS timeout_ms,
      COALESCE((elem->>'max_attempts')::INT, 5) AS max_attempts,
      COALESCE((elem->>'run_at')::TIMESTAMPTZ, NOW()) AS run_at
    FROM unnest(p_jobs) AS elem
  )
  INSERT INTO jobforge_jobs (
    tenant_id,
    type,
    payload,
    idempotency_key,
    priority,
    timeout_ms,
    max_attempts,
    run_at,
    status
  )
  SELECT 
    tenant_id,
    type,
    payload,
    idempotency_key,
    priority,
    timeout_ms,
    max_attempts,
    run_at,
    'queued'
  FROM input_jobs
  ON CONFLICT (tenant_id, type, idempotency_key)
  WHERE idempotency_key IS NOT NULL
  DO UPDATE SET updated_at = NOW()
  RETURNING *;
END;
$$;

-- ============================================================================
-- 7. RPC: jobforge_reclaim_stuck_jobs (Atomic Recovery for Crashed Workers)
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_reclaim_stuck_jobs(
  p_stale_threshold_seconds INT DEFAULT 300
)
RETURNS TABLE (reclaimed_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  WITH stuck AS (
    SELECT id
    FROM jobforge_jobs
    WHERE status = 'running'
      AND heartbeat_at < NOW() - (p_stale_threshold_seconds || ' seconds')::INTERVAL
    FOR UPDATE SKIP LOCKED
  )
  UPDATE jobforge_jobs j
  SET status = 'queued',
      locked_by = NULL,
      locked_at = NULL,
      run_at = NOW(),
      updated_at = NOW()
  FROM stuck
  WHERE j.id = stuck.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- ============================================================================
-- 8. RPC: jobforge_bulk_reschedule_dead
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_bulk_reschedule_dead(
  p_tenant_id UUID,
  p_job_ids UUID[]
)
RETURNS TABLE (rescheduled_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  UPDATE jobforge_jobs
  SET status = 'queued',
      attempts = 0,
      error = NULL,
      run_at = NOW(),
      locked_by = NULL,
      locked_at = NULL,
      finished_at = NULL,
      updated_at = NOW()
  WHERE tenant_id = p_tenant_id
    AND id = ANY(p_job_ids)
    AND status IN ('failed', 'dead');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- ============================================================================
-- 9. RPC: jobforge_purge_old_jobs (Data Retention & Maintenance)
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_purge_old_jobs(
  p_retention_days INT DEFAULT 90
)
RETURNS TABLE (purged_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM jobforge_jobs
  WHERE status IN ('succeeded', 'dead', 'canceled')
    AND finished_at < NOW() - (p_retention_days || ' days')::INTERVAL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN QUERY SELECT v_count;
END;
$$;

-- ============================================================================
-- 10. RLS POLICIES & GRANTS
-- ============================================================================
ALTER TABLE jobforge_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobforge_api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobforge_quotas ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_tenants_select ON jobforge_tenants
  FOR SELECT USING (
    id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_quotas_select ON jobforge_quotas
  FOR SELECT USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

GRANT SELECT ON jobforge_tenants TO authenticated, anon;
GRANT SELECT ON jobforge_quotas TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_enqueue_batch(UUID, JSONB[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION jobforge_reclaim_stuck_jobs(INT) TO service_role;
GRANT EXECUTE ON FUNCTION jobforge_bulk_reschedule_dead(UUID, UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION jobforge_purge_old_jobs(INT) TO service_role;
