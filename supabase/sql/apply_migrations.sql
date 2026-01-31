-- JobForge: Apply all migrations
-- Run this script to set up JobForge in your Postgres database

-- Note: This script is idempotent - safe to run multiple times
-- For Supabase users: Run via SQL Editor or supabase migration

\echo 'Applying JobForge migrations...'

-- Core schema, RPC, and RLS
\i ../migrations/001_jobforge_core.sql

\echo 'JobForge migrations applied successfully!'
\echo ''
\echo 'Next steps:'
\echo '1. Test with: psql -f ../tests/test_rls_isolation.sql'
\echo '2. Enqueue your first job using the SDK'
\echo '3. Run a worker to process jobs'
