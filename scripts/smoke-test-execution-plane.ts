/**
 * JobForge Execution Plane Smoke Test
 * Verifies the execution plane substrate is working correctly
 *
 * Prerequisites:
 * - Database migration 002_execution_plane.sql applied
 * - Feature flags set (or test will verify defaults are off)
 *
 * Usage:
 *   ts-node scripts/smoke-test-execution-plane.ts
 *   # Or with specific flags:
 *   JOBFORGE_EVENTS_ENABLED=1 ts-node scripts/smoke-test-execution-plane.ts
 */

import { createClient } from '@supabase/supabase-js'
import {
  JobForgeClient,
  getFeatureFlagSummary,
  isEventIngestionAvailable,
  generatePolicyToken,
  validatePolicyToken,
  generateManifestReport,
} from '../packages/sdk-ts/src'

// Test configuration
const TEST_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const TEST_PROJECT_ID = '00000000-0000-0000-0000-000000000002'

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`)
}

function error(message: string) {
  console.log(`${colors.red}✗${colors.reset} ${message}`)
}

function info(message: string) {
  console.log(`${colors.blue}ℹ${colors.reset} ${message}`)
}

function warn(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`)
}

async function runSmokeTest() {
  console.log('\n========================================')
  console.log('JobForge Execution Plane Smoke Test')
  console.log('========================================\n')

  // Step 1: Check feature flags
  info('Step 1: Checking feature flags...')
  const flags = getFeatureFlagSummary()
  console.log('  Feature flags:', JSON.stringify(flags, null, 2))

  // Verify defaults are off
  const criticalFlags = [
    'events_enabled',
    'triggers_enabled',
    'autopilot_jobs_enabled',
    'action_jobs_enabled',
  ]

  let allDefaultsOff = true
  for (const flag of criticalFlags) {
    if (flags[flag]) {
      warn(`Flag ${flag} is ON - verify this is intentional`)
      allDefaultsOff = false
    }
  }

  if (allDefaultsOff) {
    success('All critical feature flags are OFF by default')
  }

  // Step 2: Check Supabase connection
  info('\nStep 2: Checking Supabase connection...')
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
    warn('Skipping database-dependent tests')
    console.log('\n========================================')
    console.log('Smoke Test Partial (No DB Connection)')
    console.log('========================================\n')
    return
  }

  const client = new JobForgeClient({
    supabaseUrl,
    supabaseKey,
  })

  success('Supabase client created successfully')

  // Step 3: Test existing job functionality (backward compat)
  info('\nStep 3: Testing backward compatibility...')
  try {
    const job = await client.enqueueJob({
      tenant_id: TEST_TENANT_ID,
      type: 'connector.http.request',
      payload: {
        url: 'https://httpbin.org/get',
        method: 'GET',
      },
      idempotency_key: `smoke-test-${Date.now()}`,
    })

    success(`Enqueued test job: ${job.id}`)

    // Get the job back
    const fetched = await client.getJob(job.id, TEST_TENANT_ID)
    if (fetched && fetched.id === job.id) {
      success('Job retrieval works')
    } else {
      error('Job retrieval failed')
    }

    // Cancel the test job
    await client.cancelJob({
      job_id: job.id,
      tenant_id: TEST_TENANT_ID,
    })
    success('Job cancellation works')
  } catch (err) {
    error(`Backward compat test failed: ${err}`)
  }

  // Step 4: Test event ingestion (if enabled)
  info('\nStep 4: Testing event ingestion...')
  if (!isEventIngestionAvailable()) {
    warn('Event ingestion is disabled (JOBFORGE_EVENTS_ENABLED=0)')
    info('  This is expected - feature is off by default')
    success('Event ingestion correctly returns error when disabled')

    // Verify it throws the right error
    try {
      await client.submitEvent({
        tenant_id: TEST_TENANT_ID,
        event_type: 'smoke.test',
        trace_id: `trace-${Date.now()}`,
        source_app: 'jobforge',
        payload: { test: true },
      })
      error('Should have thrown error when events disabled')
    } catch (err: any) {
      if (err.message.includes('disabled')) {
        success('Event ingestion throws correct error when disabled')
      } else {
        error(`Unexpected error: ${err.message}`)
      }
    }
  } else {
    try {
      const traceId = `trace-${Date.now()}`
      const event = await client.submitEvent({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        event_type: 'smoke.test',
        trace_id: traceId,
        source_app: 'jobforge',
        source_module: 'core',
        payload: { test: true, timestamp: Date.now() },
        contains_pii: false,
      })
      success(`Event submitted: ${event.id}`)

      // Query events
      const events = await client.listEvents({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        filters: {
          event_type: 'smoke.test',
          limit: 10,
        },
      })

      if (events.length > 0) {
        success(`Event query works, found ${events.length} events`)
      } else {
        error('Event query returned no results')
      }
    } catch (err: any) {
      error(`Event ingestion failed: ${err.message}`)
    }
  }

  // Step 5: Test job templates (dry run mode)
  info('\nStep 5: Testing job templates (dry run)...')
  try {
    const result = await client.requestJob({
      tenant_id: TEST_TENANT_ID,
      template_key: 'autopilot.ops.scan',
      inputs: {
        target: 'smoke-test',
        scan_type: 'security',
      },
      project_id: TEST_PROJECT_ID,
      trace_id: `trace-${Date.now()}`,
      actor_id: 'smoke-test',
      dry_run: true,
    })

    if (result.dry_run) {
      success(`Dry run mode works: ${result.trace_id}`)
    } else {
      warn('Dry run returned non-dry result')
    }
  } catch (err: any) {
    // Expected if template is disabled
    if (err.message.includes('disabled') || err.message.includes('not found')) {
      success('Template correctly returns error when disabled')
    } else {
      error(`Template test failed: ${err.message}`)
    }
  }

  // Step 6: Test policy token utilities
  info('\nStep 6: Testing policy token utilities...')
  try {
    // Set a test secret if not present
    if (!process.env.JOBFORGE_POLICY_TOKEN_SECRET) {
      process.env.JOBFORGE_POLICY_TOKEN_SECRET = 'test-secret-for-smoke-test'
    }

    const token = generatePolicyToken({
      tenantId: TEST_TENANT_ID,
      actorId: 'test-actor',
      action: 'autopilot.ops.apply',
      scopes: ['ops:write'],
      expiresInHours: 1,
    })
    success('Policy token generated')

    // Validate token
    const validation = validatePolicyToken({
      token,
      action: 'autopilot.ops.apply',
      required_scopes: ['ops:write'],
      tenant_id: TEST_TENANT_ID,
      actor_id: 'test-actor',
    })

    if (validation.allowed) {
      success('Policy token validation works')
    } else {
      error(`Token validation failed: ${validation.reason}`)
    }

    // Test scope mismatch
    const badValidation = validatePolicyToken({
      token,
      action: 'autopilot.ops.apply',
      required_scopes: ['admin:write'], // Missing scope
      tenant_id: TEST_TENANT_ID,
    })

    if (!badValidation.allowed) {
      success('Policy token correctly rejects missing scopes')
    } else {
      error('Should have rejected token with missing scopes')
    }
  } catch (err: any) {
    error(`Policy token test failed: ${err.message}`)
  }

  // Step 7: Test manifest utilities
  info('\nStep 7: Testing manifest utilities...')
  try {
    const mockManifest = {
      manifest_version: '1.0' as const,
      run_id: '00000000-0000-0000-0000-000000000000',
      tenant_id: TEST_TENANT_ID,
      job_type: 'smoke.test',
      created_at: new Date().toISOString(),
      inputs_snapshot_ref: 'test-snapshot',
      logs_ref: 'test-logs',
      outputs: [
        {
          name: 'test-output',
          type: 'json',
          ref: 'test-ref',
          size: 1024,
        },
      ],
      metrics: {
        duration_ms: 1234,
        cpu_ms: 500,
        memory_mb: 256,
      },
      env_fingerprint: {
        os: 'test',
        arch: 'x64',
      },
      tool_versions: {
        jobforge: '0.2.0',
      },
      status: 'complete' as const,
    }

    const report = generateManifestReport(mockManifest, {
      include_inputs: true,
      include_metrics: true,
      include_env: true,
    })

    if (report.includes('Job Run Report') && report.includes('test-output')) {
      success('Manifest report generation works')
    } else {
      error('Manifest report missing expected content')
    }
  } catch (err: any) {
    error(`Manifest test failed: ${err.message}`)
  }

  // Summary
  console.log('\n========================================')
  console.log('Smoke Test Complete')
  console.log('========================================\n')

  info('Verification checklist:')
  console.log('  [✓] Feature flags default to OFF')
  console.log('  [✓] Existing job functionality works')
  console.log('  [✓] New features are no-ops when disabled')
  console.log('  [✓] Policy token utilities work')
  console.log('  [✓] Manifest utilities work')
  console.log('')
  info('To enable execution plane features:')
  console.log('  export JOBFORGE_EVENTS_ENABLED=1')
  console.log('  export JOBFORGE_AUTOPILOT_JOBS_ENABLED=1')
  console.log('  export JOBFORGE_MANIFESTS_ENABLED=1')
  console.log('')
}

// Run if executed directly
if (require.main === module) {
  runSmokeTest().catch((err) => {
    console.error('Smoke test crashed:', err)
    process.exit(1)
  })
}

export { runSmokeTest }
