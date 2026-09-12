-- JobForge Schema Expansion: Table Partitioning & Enterprise Scaling
-- Version: 0.4.0
-- Depends: 001_jobforge_core.sql, 002_execution_plane.sql, 003_tenants_and_auth.sql

-- ============================================================================
-- 1. PARTITIONED AUDIT LOGS
-- ============================================================================
-- Create monthly partitioned audit log table for tamper-evident compliance
CREATE TABLE IF NOT EXISTS jobforge_audit_logs_partitioned (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  prev_hash TEXT,
  record_hash TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Create active monthly partitions for current operational cycle
CREATE TABLE IF NOT EXISTS jobforge_audit_logs_y2026m09 PARTITION OF jobforge_audit_logs_partitioned
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS jobforge_audit_logs_y2026m10 PARTITION OF jobforge_audit_logs_partitioned
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS jobforge_audit_logs_y2026m11 PARTITION OF jobforge_audit_logs_partitioned
  FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');

CREATE INDEX IF NOT EXISTS idx_audit_partitioned_tenant 
  ON jobforge_audit_logs_partitioned (tenant_id, created_at DESC);

-- ============================================================================
-- 2. PARTITIONED HISTORICAL EVENTS
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_events_partitioned (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE IF NOT EXISTS jobforge_events_y2026m09 PARTITION OF jobforge_events_partitioned
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

CREATE TABLE IF NOT EXISTS jobforge_events_y2026m10 PARTITION OF jobforge_events_partitioned
  FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');

CREATE INDEX IF NOT EXISTS idx_events_partitioned_tenant 
  ON jobforge_events_partitioned (tenant_id, created_at DESC);

-- ============================================================================
-- 3. AUTOMATED PARTITION CREATION FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_create_next_month_partitions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_next_month DATE := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '1 month');
  v_following_month DATE := DATE_TRUNC('month', CURRENT_DATE + INTERVAL '2 month');
  v_suffix TEXT := TO_CHAR(v_next_month, 'yYYYYmMM');
  v_sql TEXT;
BEGIN
  v_sql := FORMAT(
    'CREATE TABLE IF NOT EXISTS jobforge_audit_logs_%s PARTITION OF jobforge_audit_logs_partitioned FOR VALUES FROM (%L) TO (%L)',
    v_suffix, v_next_month, v_following_month
  );
  EXECUTE v_sql;

  v_sql := FORMAT(
    'CREATE TABLE IF NOT EXISTS jobforge_events_%s PARTITION OF jobforge_events_partitioned FOR VALUES FROM (%L) TO (%L)',
    v_suffix, v_next_month, v_following_month
  );
  EXECUTE v_sql;
END;
$$;
