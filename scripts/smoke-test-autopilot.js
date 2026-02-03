#!/usr/bin/env node
/**
 * Quick smoke test for autopilot integration
 * Tests the bundle executor with feature flags
 */

// Test imports
const path = require('path')

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
JobForge Autopilot Smoke Test

Usage:
  node scripts/smoke-test-autopilot.js [options]

Options:
  --help, -h   Show this help and exit

Requirements:
  - Run "pnpm run build" to build worker-ts handlers before running.

Examples:
  pnpm run build
  node scripts/smoke-test-autopilot.js
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp()
  process.exit(EXIT_CODES.success)
}

// Check if dist exists
const distPath = path.join(__dirname, '..', 'services', 'worker-ts', 'dist')
const fs = require('fs')

if (!fs.existsSync(distPath)) {
  console.error('❌ Build output not found. Please run "pnpm run build" first.')
  process.exit(EXIT_CODES.validation)
}

// Test constants
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001'
const TEST_TRACE_ID = 'trace-test-001'

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

// Test 1: Handler returns disabled when flags off
async function testDisabled() {
  console.log('\n=== Test 1: Handler with Flags OFF ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '0'

  const { opsScanHandler } = getHandlers()
  const context = createMockContext('job-test-001')
  const result = await opsScanHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      scan_type: 'health',
    },
    context
  )

  const success = !result.success && result.data?.disabled === true
  printResult('Handler returns disabled when flags off', success, {
    success: result.success,
    disabled: result.data?.disabled,
  })

  return success
}

// Test 2: Handler works when flags on (stubbed)
async function testEnabled() {
  console.log('\n=== Test 2: Handler with Flags ON ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'

  const { opsScanHandler } = getHandlers()
  const context = createMockContext('job-test-002')
  const result = await opsScanHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      scan_type: 'health',
    },
    context
  )

  const success = result.success && result.manifest?.status === 'complete'
  printResult('Handler executes when flags on', success, {
    success: result.success,
    status: result.manifest?.status,
  })

  return success
}

// Test 3: Bundle executor with flags off
async function testBundleDisabled() {
  console.log('\n=== Test 3: Bundle Executor with Flags OFF ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '0'

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-001',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'health' },
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const { executeRequestBundleHandler } = getHandlers()
  const context = createMockContext('job-test-bundle-001')
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

  const success = !result.success && result.summary?.errors === 1
  printResult('Bundle executor returns error when flags off', success, {
    success: result.success,
    errors: result.summary?.errors,
  })

  return success
}

// Test 4: Bundle executor dry run with flags on
async function testBundleDryRun() {
  console.log('\n=== Test 4: Bundle Executor Dry Run ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-002',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-001',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'health' },
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
          ticket_content: { subject: 'Test', body: 'Test' },
          customer_context: { customer_id: 'cust-123' },
        },
        is_action_job: false,
      },
    ],
    metadata: {
      source: 'test',
      triggered_at: new Date().toISOString(),
    },
  }

  const { executeRequestBundleHandler } = getHandlers()
  const context = createMockContext('job-test-bundle-002')
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

  const success =
    result.success &&
    result.dry_run === true &&
    result.child_runs?.length === 2 &&
    result.summary?.accepted === 2

  printResult('Bundle executor dry run accepts all jobs', success, {
    success: result.success,
    dry_run: result.dry_run,
    child_runs: result.child_runs?.length,
    accepted: result.summary?.accepted,
  })

  return success
}

// Test 5: Action job blocked without policy token
async function testActionJobBlocked() {
  console.log('\n=== Test 5: Action Job Policy Enforcement ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'
  process.env.JOBFORGE_ACTION_JOBS_ENABLED = '1'

  const bundle = {
    version: '1.0',
    bundle_id: 'test-bundle-action',
    tenant_id: TEST_TENANT_ID,
    project_id: TEST_PROJECT_ID,
    trace_id: TEST_TRACE_ID,
    requests: [
      {
        id: 'req-scan',
        job_type: 'autopilot.ops.scan',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        payload: { tenant_id: TEST_TENANT_ID, project_id: TEST_PROJECT_ID, scan_type: 'health' },
        is_action_job: false,
      },
      {
        id: 'req-apply',
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

  const { executeRequestBundleHandler } = getHandlers()
  const context = createMockContext('job-test-action-001')
  const result = await executeRequestBundleHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      trace_id: TEST_TRACE_ID,
      request_bundle: bundle,
      mode: 'execute',
      // No policy token
    },
    context
  )

  const success =
    !result.success &&
    result.summary?.action_jobs_blocked >= 1 &&
    result.child_runs?.some((r) => r.job_type === 'autopilot.ops.apply' && r.status === 'denied')

  printResult('Action jobs blocked without policy token', success, {
    success: result.success,
    action_jobs_blocked: result.summary?.action_jobs_blocked,
    denied: result.summary?.denied,
  })

  return success
}

// Main runner
async function runTests() {
  console.log('╔════════════════════════════════════════════════════════════════╗')
  console.log('║    JobForge Autopilot Smoke Test                               ║')
  console.log('╚════════════════════════════════════════════════════════════════╝')

  const results = []

  try {
    results.push(await testDisabled())
    results.push(await testEnabled())
    results.push(await testBundleDisabled())
    results.push(await testBundleDryRun())
    results.push(await testActionJobBlocked())
  } catch (error) {
    logUnexpectedError('\n💥 Test failed with error', error)
    process.exit(EXIT_CODES.failure)
  }

  const passed = results.filter((r) => r).length
  const total = results.length

  console.log('\n╔════════════════════════════════════════════════════════════════╗')
  console.log(`║  Results: ${passed}/${total} tests passed                              ║`)
  console.log('╚════════════════════════════════════════════════════════════════╝')

  if (passed === total) {
    console.log('\n✨ All smoke tests passed!')
    process.exit(EXIT_CODES.success)
  } else {
    console.log('\n⚠️  Some tests failed.')
    process.exit(EXIT_CODES.failure)
  }
}

runTests().catch((err) => {
  logUnexpectedError('Unhandled error', err)
  process.exit(EXIT_CODES.failure)
})
