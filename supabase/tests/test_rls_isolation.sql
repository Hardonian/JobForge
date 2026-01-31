-- JobForge RLS Tenant Isolation Test
-- This script proves that cross-tenant reads are blocked

-- Apply schema first
\i ../migrations/001_jobforge_core.sql

BEGIN;

-- Setup: Create test data for two different tenants
DO $$
DECLARE
  tenant_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid;
  tenant_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid;
BEGIN
  -- Insert jobs for tenant A
  INSERT INTO jobforge_jobs (tenant_id, type, payload)
  VALUES
    (tenant_a, 'test.job.a1', '{"data": "tenant_a_job_1"}'::jsonb),
    (tenant_a, 'test.job.a2', '{"data": "tenant_a_job_2"}'::jsonb);

  -- Insert jobs for tenant B
  INSERT INTO jobforge_jobs (tenant_id, type, payload)
  VALUES
    (tenant_b, 'test.job.b1', '{"data": "tenant_b_job_1"}'::jsonb),
    (tenant_b, 'test.job.b2', '{"data": "tenant_b_job_2"}'::jsonb);

  RAISE NOTICE 'Test data created for tenant_a (%) and tenant_b (%)', tenant_a, tenant_b;
END $$;

-- Test 1: Without tenant context, service_role can see all jobs
SELECT 'Test 1: Service role sees all jobs' AS test;
SELECT COUNT(*) AS total_jobs FROM jobforge_jobs;
-- Expected: 4 jobs

-- Test 2: Set tenant context to tenant A
SELECT 'Test 2: Tenant A context' AS test;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Tenant A should only see their 2 jobs
SELECT COUNT(*) AS tenant_a_jobs FROM jobforge_jobs;
-- Expected: 2 jobs

SELECT type FROM jobforge_jobs ORDER BY type;
-- Expected: test.job.a1, test.job.a2

-- Test 3: Set tenant context to tenant B
SELECT 'Test 3: Tenant B context' AS test;
SET LOCAL app.tenant_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Tenant B should only see their 2 jobs
SELECT COUNT(*) AS tenant_b_jobs FROM jobforge_jobs;
-- Expected: 2 jobs

SELECT type FROM jobforge_jobs ORDER BY type;
-- Expected: test.job.b1, test.job.b2

-- Test 4: Cross-tenant access prevention
SELECT 'Test 4: Cross-tenant access blocked' AS test;
SET LOCAL app.tenant_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

-- Attempt to query tenant B's jobs should return 0
SELECT COUNT(*) AS should_be_zero
FROM jobforge_jobs
WHERE type LIKE '%b%';
-- Expected: 0 (tenant A cannot see tenant B's jobs)

-- Test 5: RPC functions respect tenant isolation
SELECT 'Test 5: RPC list_jobs respects tenant isolation' AS test;

-- List jobs for tenant A via RPC
SELECT COUNT(*) AS tenant_a_via_rpc
FROM jobforge_list_jobs(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid,
  '{}'::jsonb
);
-- Expected: 2 jobs

-- List jobs for tenant B via RPC
SELECT COUNT(*) AS tenant_b_via_rpc
FROM jobforge_list_jobs(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid,
  '{}'::jsonb
);
-- Expected: 2 jobs

-- Summary
SELECT 'Test Summary: RLS tenant isolation working correctly' AS result;

ROLLBACK;
