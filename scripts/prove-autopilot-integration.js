#!/usr/bin/env node
/**
 * JobForge Autopilot Integration Proving Script
 *
 * This script demonstrates end-to-end integration of the autopilot job system
 * without requiring external APIs. It runs deterministic tests locally.
 *
 * Usage:
 *   node scripts/prove-autopilot-integration.js
 *
 * Tests:
 * 1. Dry-run bundle execution (flags off) -> "blocked/disabled" responses
 * 2. Execute bundle (flags on) -> produces child manifests
 * 3. Verify action job gating (policy tokens)
 */

let cachedHandlers = null

function getHandlers() {
  if (cachedHandlers) {
    return cachedHandlers
  }
  const {
    executeRequestBundleHandler,
  } = require('../services/worker-ts/dist/handlers/autopilot/execute-bundle')
  const { opsScanHandler } = require('../services/worker-ts/dist/handlers/autopilot/ops')
  cachedHandlers = { executeRequestBundleHandler, opsScanHandler }
  return cachedHandlers
}

const EXIT_CODES = {
  success: 0,
  validation: 2,
  failure: 1,
}

const DEBUG_ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

function formatError(error) {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function logUnexpectedError(message, error) {
  console.error(`${message}: ${formatError(error)}`)
  if (DEBUG_ENABLED && error instanceof Error && error.stack) {
    console.error(error.stack)
  }
}

function showHelp() {
  console.log(`
JobForge Autopilot Integration Proving Script

Usage:
  node scripts/prove-autopilot-integration.js [options]

Options:
  --help, -h   Show this help and exit

Requirements:
  - Run "pnpm run build" to build worker-ts handlers before running.

Examples:
  pnpm run build
  node scripts/prove-autopilot-integration.js
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp()
  process.exit(EXIT_CODES.success)
}

// Test constants
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001'
const TEST_TRACE_ID = 'trace-test-001'

// Mock job context
function createMockContext(jobId) {
  return {
    job_id: jobId,
    tenant_id: TEST_TENANT_ID,
    attempt_no: 1,
    trace_id: TEST_TRACE_ID,
    heartbeat: async () => {},
  }
}

// Helper to print results
function printResult(name, success, details = {}) {
  const status = success ? '✅ PASS' : '❌ FAIL'
  console.log(`\n${status}: ${name}`)
  if (Object.keys(details).length > 0) {
    console.log('  Details:', JSON.stringify(details, null, 2).replace(/\n/g, '\n  '))
  }
}

// Test 1: Dry run with flags off (should be disabled)
async function testDryRunDisabled() {
  console.log('\n=== Test 1: Dry Run with Flags OFF ===')

  // Ensure flags are off
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '0'

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-disabled',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          scan_type: 'health',
        },
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const context = createMockContext('job-test-disabled-001')

  const { executeRequestBundleHandler } = getHandlers()
  const result = await executeRequestBundleHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'dry_run',
    },
    context
  )

  // Restore flag
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag

  const success =
    !result.success && result.summary.errors === 1 && result.manifest.status === 'failed'

  printResult('Dry run with flags off returns disabled', success, {
    success: result.success,
    errors: result.summary.errors,
    status: result.manifest.status,
  })

  return success
}

// Test 2: Direct handler call with flags off
async function testDirectHandlerDisabled() {
  console.log('\n=== Test 2: Direct Handler with Flags OFF ===')

  // Ensure flags are off
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '0'

  const context = createMockContext('job-test-direct-001')

  const { opsScanHandler } = getHandlers()
  const result = await opsScanHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      scan_type: 'health',
    },
    context
  )

  // Restore flag
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag

  const success =
    !result.success && result.data?.disabled === true && result.manifest.status === 'failed'

  printResult('Direct handler with flags off returns disabled', success, {
    success: result.success,
    disabled: result.data?.disabled,
    status: result.manifest.status,
  })

  return success
}

// Test 3: Dry run with flags on
async function testDryRunEnabled() {
  console.log('\n=== Test 3: Dry Run with Flags ON ===')

  // Enable flags
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'

  // Force re-import to pick up new flag value
  delete require.cache[
    require.resolve('../services/worker-ts/dist/handlers/autopilot/execute-bundle')
  ]
  cachedHandlers = null
  const { executeRequestBundleHandler: handler } = getHandlers()

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-dry-run',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          scan_type: 'health',
        },
        is_action_job: false,
      },
      {
        id: 'req-002',
        job_type: 'autopilot.support.triage',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          ticket_id: 'TICKET-123',
          ticket_content: {
            subject: 'Test ticket',
            body: 'Test content',
          },
          customer_context: {
            customer_id: 'cust-123',
          },
        },
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const context = createMockContext('job-test-dry-run-001')

  const result = await handler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'dry_run',
    },
    context
  )

  // Restore flag
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag

  const success =
    result.success &&
    result.dry_run === true &&
    result.child_runs.length === 2 &&
    result.child_runs.every((r) => r.status === 'accepted') &&
    result.summary.accepted === 2

  printResult('Dry run with flags on accepts all jobs', success, {
    success: result.success,
    dry_run: result.dry_run,
    child_runs_count: result.child_runs.length,
    accepted: result.summary.accepted,
  })

  return success
}

// Test 4: Action job blocked without policy token
async function testActionJobBlocked() {
  console.log('\n=== Test 4: Action Job Blocked Without Policy Token ===')

  // Enable flags but don't provide policy token
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  const originalActionFlag = process.env.JOBFORGE_ACTION_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'
  process.env.JOBFORGE_ACTION_JOBS_ENABLED = '1'

  // Force re-import
  delete require.cache[
    require.resolve('../services/worker-ts/dist/handlers/autopilot/execute-bundle')
  ]
  cachedHandlers = null
  const { executeRequestBundleHandler: handler } = getHandlers()

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-action',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-scan-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          scan_type: 'health',
        },
        is_action_job: false,
      },
      {
        id: 'req-apply-001',
        job_type: 'autopilot.ops.apply',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          recommendation_id: 'rec-123',
        },
        is_action_job: true,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const context = createMockContext('job-test-action-001')

  const result = await handler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'execute',
      // No policy token provided
    },
    context
  )

  // Restore flags
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag
  process.env.JOBFORGE_ACTION_JOBS_ENABLED = originalActionFlag

  const success =
    !result.success &&
    result.summary.action_jobs_blocked === 1 &&
    result.summary.denied === 2 && // Both denied due to policy failure
    result.child_runs.some((r) => r.job_type === 'autopilot.ops.apply' && r.status === 'denied')

  printResult('Action job blocked without policy token', success, {
    success: result.success,
    action_jobs_blocked: result.summary.action_jobs_blocked,
    denied: result.summary.denied,
    apply_job_status: result.child_runs.find((r) => r.job_type === 'autopilot.ops.apply')?.status,
  })

  return success
}

// Test 5: Duplicate detection
async function testDuplicateDetection() {
  console.log('\n=== Test 5: Duplicate Request Detection ===')

  // Enable flags
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'

  // Force re-import
  delete require.cache[
    require.resolve('../services/worker-ts/dist/handlers/autopilot/execute-bundle')
  ]
  cachedHandlers = null
  const { executeRequestBundleHandler: handler } = getHandlers()

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-duplicates',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001', // Duplicate ID
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'health' },
        idempotency_key: 'key-001',
        is_action_job: false,
      },
      {
        id: 'req-001', // Duplicate ID - should be skipped
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'security' },
        idempotency_key: 'key-002',
        is_action_job: false,
      },
      {
        id: 'req-003',
        job_type: 'autopilot.support.triage',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: TEST_TENANT_ID,
          project_id: TEST_PROJECT_ID,
          ticket_id: 'TICKET-123',
          ticket_content: { subject: 'Test', body: 'Test' },
          customer_context: { customer_id: 'cust-123' },
        },
        idempotency_key: 'key-001', // Duplicate idempotency key - should be skipped
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const context = createMockContext('job-test-dup-001')

  const result = await handler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'dry_run',
    },
    context
  )

  // Restore flag
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag

  const success =
    result.summary.skipped === 2 &&
    result.child_runs.filter((r) => r.status === 'skipped').length === 2

  printResult('Duplicate requests are detected and skipped', success, {
    total: result.summary.total,
    skipped: result.summary.skipped,
    accepted: result.summary.accepted,
    skipped_reasons: result.child_runs.filter((r) => r.status === 'skipped').map((r) => r.reason),
  })

  return success
}

// Test 6: Tenant/Project scoping enforcement
async function testTenantScoping() {
  console.log('\n=== Test 6: Tenant/Project Scoping Enforcement ===')

  // Enable flags
  const originalAutopilotFlag = process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'

  // Force re-import
  delete require.cache[
    require.resolve('../services/worker-ts/dist/handlers/autopilot/execute-bundle')
  ]
  cachedHandlers = null
  const { executeRequestBundleHandler: handler } = getHandlers()

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-scope',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID, // Correct tenant
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'health' },
        is_action_job: false,
      },
      {
        id: 'req-002',
        job_type: 'autopilot.ops.scan',
        tenant_id: '660e8400-e29b-41d4-a716-446655440999', // Different tenant (valid UUID)
        project_id: TEST_PROJECT_ID,
        payload: {
          tenant_id: '660e8400-e29b-41d4-a716-446655440999',
          project_id: TEST_PROJECT_ID,
          scan_type: 'security',
        },
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const context = createMockContext('job-test-scope-001')

  const result = await handler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'dry_run',
    },
    context
  )

  // Restore flag
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = originalAutopilotFlag

  const success =
    result.summary.denied === 1 &&
    result.child_runs.some((r) => r.request_id === 'req-002' && r.status === 'denied') &&
    result.child_runs.some((r) => r.request_id === 'req-001' && r.status === 'accepted')

  printResult('Tenant scoping is enforced', success, {
    total: result.summary.total,
    denied: result.summary.denied,
    accepted: result.summary.accepted,
    req_001_status: result.child_runs.find((r) => r.request_id === 'req-001')?.status,
    req_002_status: result.child_runs.find((r) => r.request_id === 'req-002')?.status,
  })

  return success
}

// Main test runner
async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║    JobForge Autopilot Integration Proving Script               ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')
  console.log('\nThis script validates the autopilot integration without external APIs.')
  console.log('All tests run locally with deterministic outcomes.')

  const results = []

  try {
    results.push(await testDryRunDisabled())
    results.push(await testDirectHandlerDisabled())
    results.push(await testDryRunEnabled())
    results.push(await testActionJobBlocked())
    results.push(await testDuplicateDetection())
    results.push(await testTenantScoping())
  } catch (error) {
    logUnexpectedError('\n💥 Test suite failed with error', error)
    process.exit(EXIT_CODES.failure)
  }

  const passed = results.filter((r) => r).length
  const total = results.length

  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log(`║  Results: ${passed}/${total} tests passed                              ║`)
  console.log('╚════════════════════════════════════════════════════════════════╝')

  if (passed === total) {
    console.log('\n✨ All integration tests passed!')
    process.exit(EXIT_CODES.success)
  } else {
    console.log('\n⚠️  Some tests failed.')
    process.exit(EXIT_CODES.failure)
  }
}

// Run tests
runAllTests().catch((error) => {
  logUnexpectedError('Unhandled error', error)
  process.exit(EXIT_CODES.failure)
})
