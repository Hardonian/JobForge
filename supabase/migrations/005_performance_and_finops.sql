-- JobForge Schema Expansion: Queue Performance Tuning & FinOps Resource Attribution
-- Version: 0.5.0
-- Depends: 001_jobforge_core.sql, 002_execution_plane.sql, 003_tenants_and_auth.sql, 004_table_partitioning.sql

-- ============================================================================
-- 1. COVERING INDEX FOR ZERO-HEAP INDEX-ONLY CLAIMS
-- ============================================================================
-- High-throughput covering index allowing queue claim operations to resolve
-- metadata directly from index pages before row-level locking.
CREATE INDEX IF NOT EXISTS idx_jobforge_jobs_claim_covering
  ON jobforge_jobs (status, run_at, priority DESC)
  INCLUDE (id, tenant_id, type, attempts, max_attempts, timeout_ms)
  WHERE status = 'queued';

-- Additional covering index for zombie heartbeat reclaim scanning
CREATE INDEX IF NOT EXISTS idx_jobforge_jobs_zombie_reclaim_covering
  ON jobforge_jobs (status, heartbeat_at)
  INCLUDE (id, tenant_id, locked_by, attempts)
  WHERE status = 'running';

-- ============================================================================
-- 2. AUTOVACUUM QUEUE STORAGE PARAMETERS
-- ============================================================================
-- JobForge is a high-turnover queue table where jobs enter 'queued' and exit
-- rapidly into 'succeeded' or 'failed'. Aggressive vacuum settings prevent bloat.
ALTER TABLE jobforge_jobs SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_vacuum_cost_limit = 1000,
  autovacuum_vacuum_threshold = 50
);

-- ============================================================================
-- 3. FAIR-SHARE TENANT CLAIM RPC (NOISY-NEIGHBOR PROTECTION)
-- ============================================================================
-- Interleaves job claims across distinct tenants to guarantee that a tenant
-- with a burst of 10,000 enqueued jobs cannot starve other tenants' workloads.
CREATE OR REPLACE FUNCTION claim_jobs_fair_share(
  p_worker_id TEXT,
  p_limit INT DEFAULT 10,
  p_tenant_limit INT DEFAULT 2
)
RETURNS SETOF jobforge_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_ids UUID[];
BEGIN
  -- Select jobs partitioned by tenant_id with row_number limit per tenant
  WITH ranked_jobs AS (
    SELECT 
      id,
      ROW_NUMBER() OVER (
        PARTITION BY tenant_id 
        ORDER BY priority DESC, run_at ASC, created_at ASC
      ) AS rank_in_tenant
    FROM jobforge_jobs
    WHERE status = 'queued'
      AND run_at <= NOW()
    FOR UPDATE SKIP LOCKED
  ),
  selected_jobs AS (
    SELECT id
    FROM ranked_jobs
    WHERE rank_in_tenant <= p_tenant_limit
    ORDER BY rank_in_tenant ASC
    LIMIT p_limit
  )
  SELECT array_agg(id) INTO v_job_ids FROM selected_jobs;

  IF v_job_ids IS NULL OR array_length(v_job_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Lock and update the selected jobs
  RETURN QUERY
  UPDATE jobforge_jobs
  SET 
    status = 'running',
    locked_at = NOW(),
    locked_by = p_worker_id,
    heartbeat_at = NOW(),
    started_at = COALESCE(started_at, NOW()),
    attempts = attempts + 1,
    updated_at = NOW()
  WHERE id = ANY(v_job_ids)
  RETURNING *;
END;
$$;

-- ============================================================================
-- 4. FINOPS RESOURCE ATTRIBUTION & TENANT USAGE TRACKING
-- ============================================================================
-- Daily aggregated compute, memory, and payload usage per tenant for 
-- cost attribution, SLA monitoring, and SaaS profit margin calculation.
CREATE TABLE IF NOT EXISTS jobforge_tenant_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  period_date DATE NOT NULL DEFAULT CURRENT_DATE,
  jobs_completed INT NOT NULL DEFAULT 0,
  jobs_failed INT NOT NULL DEFAULT 0,
  compute_ms BIGINT NOT NULL DEFAULT 0,
  ingress_bytes BIGINT NOT NULL DEFAULT 0,
  egress_bytes BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12, 6) NOT NULL DEFAULT 0.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_tenant_usage_period UNIQUE (tenant_id, period_date)
);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_tenant_date
  ON jobforge_tenant_usage (tenant_id, period_date DESC);

-- RPC to record job execution telemetry and increment FinOps metrics
CREATE OR REPLACE FUNCTION record_tenant_job_usage(
  p_tenant_id UUID,
  p_status TEXT,
  p_duration_ms BIGINT,
  p_ingress_bytes BIGINT DEFAULT 0,
  p_egress_bytes BIGINT DEFAULT 0,
  p_compute_cost_per_hour NUMERIC DEFAULT 0.05
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost_delta NUMERIC(12, 6);
  v_is_success INT := CASE WHEN p_status = 'succeeded' THEN 1 ELSE 0 END;
  v_is_failure INT := CASE WHEN p_status = 'failed' OR p_status = 'dead' THEN 1 ELSE 0 END;
BEGIN
  -- Compute cost = duration in hours * hourly compute rate ($0.05 default per worker core)
  v_cost_delta := (p_duration_ms::numeric / 3600000.0) * p_compute_cost_per_hour;

  INSERT INTO jobforge_tenant_usage (
    tenant_id,
    period_date,
    jobs_completed,
    jobs_failed,
    compute_ms,
    ingress_bytes,
    egress_bytes,
    estimated_cost_usd,
    updated_at
  )
  VALUES (
    p_tenant_id,
    CURRENT_DATE,
    v_is_success,
    v_is_failure,
    GREATEST(p_duration_ms, 0),
    GREATEST(p_ingress_bytes, 0),
    GREATEST(p_egress_bytes, 0),
    GREATEST(v_cost_delta, 0),
    NOW()
  )
  ON CONFLICT (tenant_id, period_date)
  DO UPDATE SET
    jobs_completed = jobforge_tenant_usage.jobs_completed + v_is_success,
    jobs_failed = jobforge_tenant_usage.jobs_failed + v_is_failure,
    compute_ms = jobforge_tenant_usage.compute_ms + GREATEST(p_duration_ms, 0),
    ingress_bytes = jobforge_tenant_usage.ingress_bytes + GREATEST(p_ingress_bytes, 0),
    egress_bytes = jobforge_tenant_usage.egress_bytes + GREATEST(p_egress_bytes, 0),
    estimated_cost_usd = jobforge_tenant_usage.estimated_cost_usd + GREATEST(v_cost_delta, 0),
    updated_at = NOW();
END;
$$;

-- RPC to retrieve billing and cost attribution summary for tenant reports
CREATE OR REPLACE FUNCTION get_tenant_billing_metrics(
  p_tenant_id UUID,
  p_start_date DATE DEFAULT (CURRENT_DATE - INTERVAL '30 days')::date,
  p_end_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  period_date DATE,
  jobs_completed INT,
  jobs_failed INT,
  compute_ms BIGINT,
  ingress_bytes BIGINT,
  egress_bytes BIGINT,
  estimated_cost_usd NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    u.period_date,
    u.jobs_completed,
    u.jobs_failed,
    u.compute_ms,
    u.ingress_bytes,
    u.egress_bytes,
    u.estimated_cost_usd
  FROM jobforge_tenant_usage u
  WHERE u.tenant_id = p_tenant_id
    AND u.period_date >= p_start_date
    AND u.period_date <= p_end_date
  ORDER BY u.period_date DESC;
END;
$$;
