/**
 * JobForge Client Smoke Test
 * Runs in DRY-RUN mode with integration disabled
 * No side effects - safe to run anywhere
 *
 * Usage: pnpm smoke
 * Or: tsx scripts/smoke.ts
 */

import { createClient, type EventEnvelope } from '../index'

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function runSmokeTest(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║     JobForge Client - Smoke Test (DRY-RUN Mode)            ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
  console.log()

  // Verify environment
  console.log('📋 Environment Check:')
  console.log(
    `   JOBFORGE_INTEGRATION_ENABLED: ${process.env.JOBFORGE_INTEGRATION_ENABLED || '0'} (default)`
  )
  console.log(`   JOBFORGE_DRY_RUN_MODE: ${process.env.JOBFORGE_DRY_RUN_MODE || '1'} (default)`)
  console.log()

  // Create client
  console.log('🔧 Creating client...')
  const client = createClient({
    // These won't be used in DRY-RUN mode but required for validation
    supabaseUrl: 'http://localhost:54321',
    supabaseKey: 'test-key',
    defaultTenantId: '00000000-0000-0000-0000-000000000001',
    dryRun: true,
  })
  console.log('   ✓ Client created')
  console.log()

  // Check feature flags
  console.log('🏳️  Feature Flags:')
  const flags = client.getFeatureFlags()
  Object.entries(flags).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  console.log()

  // Verify dry run mode
  if (!client.isDryRun()) {
    console.error('❌ ERROR: Dry run mode is not active!')
    console.error('   This script must run with JOBFORGE_DRY_RUN_MODE=1')
    process.exit(1)
  }

  if (client.isEnabled()) {
    console.warn('⚠️  Warning: Integration is enabled - running in dry-run anyway')
  }

  console.log('🧪 Test 1: submitEvent')
  console.log('   Submitting event envelope...')

  const eventEnvelope: EventEnvelope = {
    schema_version: '1.0.0',
    event_version: '1.0',
    event_type: 'smoke.test.event',
    occurred_at: new Date().toISOString(),
    trace_id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
    tenant_id: '00000000-0000-0000-0000-000000000001',
    source_app: 'jobforge',
    source_module: 'core',
    subject: {
      type: 'test',
      id: `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
    },
    payload: {
      test_name: 'smoke_test',
      test_data: {
        nested: true,
        value: 42,
      },
    },
    contains_pii: false,
  }

  try {
    const event = await client.submitEvent(eventEnvelope)
    console.log(`   ✓ Event submitted (mock ID: ${event.id})`)
    console.log(`   - Event type: ${event.event_type}`)
    console.log(`   - Trace ID: ${event.trace_id}`)
    console.log(`   - Processed: ${event.processed}`)
  } catch (error) {
    console.error('   ✗ Event submission failed:', error)
    throw error
  }
  console.log()
  await sleep(100)

  console.log('🧪 Test 2: requestJob')
  console.log('   Requesting job execution...')

  try {
    const jobResult = await client.requestJob(
      'autopilot.ops.scan',
      {
        scan_type: 'smoke_test',
        test_param: 'value',
      },
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      `00000000-0000-0000-0000-${Date.now().toString().padStart(12, '0')}`,
      `idempotency-${Date.now()}`
    )
    console.log(`   ✓ Job requested (mock run ID: ${jobResult.runId})`)
    console.log(`   - Status: ${jobResult.status}`)
    console.log(`   - Trace ID: ${jobResult.traceId}`)
    console.log(`   - Dry run: ${jobResult.dryRun}`)
    console.log(`   - Timestamp: ${jobResult.timestamp}`)
  } catch (error) {
    console.error('   ✗ Job request failed:', error)
    throw error
  }
  console.log()
  await sleep(100)

  console.log('🧪 Test 3: getRunStatus')
  console.log('   Querying run status...')

  try {
    const status = await client.getRunStatus(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001'
    )
    console.log(`   ✓ Status retrieved (mock)`)
    console.log(`   - Run ID: ${status.runId}`)
    console.log(`   - Status: ${status.status}`)
    console.log(`   - Started at: ${status.startedAt}`)
  } catch (error) {
    console.error('   ✗ Status query failed:', error)
    throw error
  }
  console.log()
  await sleep(100)

  console.log('🧪 Test 4: getRunManifest')
  console.log('   Retrieving run manifest...')

  try {
    const manifest = await client.getRunManifest(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001'
    )
    console.log(`   ✓ Manifest retrieved (mock)`)
    if (manifest) {
      console.log(`   - Manifest ID: ${manifest.id}`)
      console.log(`   - Run ID: ${manifest.run_id}`)
      console.log(`   - Job type: ${manifest.job_type}`)
      console.log(`   - Status: ${manifest.status}`)
      console.log(`   - Outputs: ${manifest.outputs.length}`)
    } else {
      console.log('   - Manifest: null (not found)')
    }
  } catch (error) {
    console.error('   ✗ Manifest retrieval failed:', error)
    throw error
  }
  console.log()
  await sleep(100)

  console.log('🧪 Test 5: listArtifacts')
  console.log('   Listing artifacts...')

  try {
    const artifacts = await client.listArtifacts(
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000001'
    )
    console.log(`   ✓ Artifacts listed (mock)`)
    console.log(`   - Run ID: ${artifacts.runId}`)
    console.log(`   - Total count: ${artifacts.totalCount}`)
    console.log(`   - Artifacts: ${JSON.stringify(artifacts.artifacts)}`)
  } catch (error) {
    console.error('   ✗ Artifact listing failed:', error)
    throw error
  }
  console.log()

  console.log('╔════════════════════════════════════════════════════════════╗')
  console.log('║  ✅ All smoke tests passed!                                ║')
  console.log('║  (Running in DRY-RUN mode - no side effects)              ║')
  console.log('╚════════════════════════════════════════════════════════════╝')
}

// Run smoke test
runSmokeTest()
  .then(() => {
    console.log()
    console.log('Smoke test completed successfully ✨')
    process.exit(0)
  })
  .catch((error) => {
    console.error()
    console.error('Smoke test failed ❌')
    console.error(error)
    process.exit(1)
  })
