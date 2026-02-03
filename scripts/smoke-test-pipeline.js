#!/usr/bin/env node
/**
 * Smoke test for the event-driven pipeline trigger.
 */

const path = require('path')
const fs = require('fs')

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
JobForge Pipeline Smoke Test

Usage:
  node scripts/smoke-test-pipeline.js [options]

Options:
  --help, -h   Show this help and exit

Requirements:
  - Run "pnpm run build" to build worker-ts handlers before running.

Examples:
  pnpm run build
  node scripts/smoke-test-pipeline.js
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp()
  process.exit(EXIT_CODES.success)
}

const distPath = path.join(__dirname, '..', 'services', 'worker-ts', 'dist')
if (!fs.existsSync(distPath)) {
  console.error('❌ Build output not found. Please run "pnpm run build" first.')
  process.exit(EXIT_CODES.validation)
}

const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001'
const TEST_TRACE_ID = 'trace-pipeline-001'

let cachedHandlers = null

function getHandlers() {
  if (cachedHandlers) return cachedHandlers
  const { runModuleCliHandler } = require('../services/worker-ts/dist/handlers/autopilot/run-module-cli')
  cachedHandlers = { runModuleCliHandler }
  return cachedHandlers
}

function createMockContext(jobId) {
  return {
    job_id: jobId,
    tenant_id: TEST_TENANT_ID,
    attempt_no: 1,
    trace_id: TEST_TRACE_ID,
    heartbeat: async () => {},
  }
}

function printResult(name, success, details = {}) {
  const status = success ? '✅ PASS' : '❌ FAIL'
  console.log(`\n${status}: ${name}`)
  if (Object.keys(details).length > 0) {
    console.log('  Details:', JSON.stringify(details, null, 2).replace(/\n/g, '\n  '))
  }
}

async function testFlagsOff() {
  console.log('\n=== Test 1: Pipeline with Flags OFF ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'
  process.env.JOBFORGE_MODULE_RUNNER_ENABLED = '0'
  process.env.JOBFORGE_BUNDLE_EXECUTOR_ENABLED = '0'
  process.env.JOBFORGE_PIPELINE_TRIGGERS_ENABLED = '0'

  const { runModuleCliHandler } = getHandlers()
  const context = createMockContext('pipeline-job-001')

  const result = await runModuleCliHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      event: {
        schema_version: '1.0.0',
        event_version: '1.0',
        event_type: 'infrastructure.alert',
        occurred_at: new Date().toISOString(),
        trace_id: TEST_TRACE_ID,
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        source_app: 'jobforge',
        source_module: 'ops',
        payload: { severity: 'high' },
        contains_pii: false,
      },
      module_id: 'autopilot.ops.scan',
      rule: {
        rule_id: '550e8400-e29b-41d4-a716-446655440099',
        name: 'Pipeline Rule',
        action_mode: 'dry_run',
        safety_allow_action_jobs: false,
        enabled: true,
      },
    },
    context
  )

  const success = !result.success && result.data?.disabled === true
  printResult('Pipeline returns disabled artifacts when flags off', success, {
    success: result.success,
    disabled: result.data?.disabled,
    pipeline_status: result.pipeline_manifest?.status,
  })

  return success
}

async function testFlagsOn() {
  console.log('\n=== Test 2: Pipeline with Flags ON ===')

  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'
  process.env.JOBFORGE_MODULE_RUNNER_ENABLED = '1'
  process.env.JOBFORGE_BUNDLE_EXECUTOR_ENABLED = '1'
  process.env.JOBFORGE_PIPELINE_TRIGGERS_ENABLED = '1'

  const { runModuleCliHandler } = getHandlers()
  const context = createMockContext('pipeline-job-002')

  const result = await runModuleCliHandler(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      event: {
        schema_version: '1.0.0',
        event_version: '1.0',
        event_type: 'infrastructure.alert',
        occurred_at: new Date().toISOString(),
        trace_id: `${TEST_TRACE_ID}-on`,
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        source_app: 'jobforge',
        source_module: 'ops',
        payload: { severity: 'high' },
        contains_pii: false,
      },
      module_id: 'autopilot.ops.scan',
      rule: {
        rule_id: '550e8400-e29b-41d4-a716-446655440100',
        name: 'Pipeline Rule',
        action_mode: 'dry_run',
        safety_allow_action_jobs: false,
        enabled: true,
      },
      mode: 'dry_run',
    },
    context
  )

  const success = result.success && result.pipeline_manifest?.status === 'dry_run'
  printResult('Pipeline produces module outputs and bundle dry run', success, {
    success: result.success,
    pipeline_status: result.pipeline_manifest?.status,
    bundle_manifest: result.bundle_execution?.bundle_manifest_ref,
  })

  return success
}

async function main() {
  try {
    const results = []
    results.push(await testFlagsOff())
    results.push(await testFlagsOn())

    const allPassed = results.every(Boolean)
    if (!allPassed) {
      console.error('\n❌ Pipeline smoke test failed')
      process.exit(EXIT_CODES.failure)
    }

    console.log('\n✅ Pipeline smoke test passed')
    process.exit(EXIT_CODES.success)
  } catch (error) {
    logUnexpectedError('Pipeline smoke test crashed', error)
    process.exit(EXIT_CODES.failure)
  }
}

main()
