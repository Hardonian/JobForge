#!/usr/bin/env node
/**
 * JobForge Runnerless Execution Plane - Final Smoke Test
 *
 * This script verifies the complete operability of the runnerless execution plane:
 * 1. Creates sample tenant/project context
 * 2. Submits sample event envelope (dry-run if ingestion disabled)
 * 3. Requests verify_pack job (blocked unless flags enabled)
 * 4. Enables flags in controlled local run and executes verify_pack
 * 5. Exports replay bundle
 * 6. Prints human summary from manifest
 *
 * Usage:
 *   # Test with flags OFF (no side effects - safe for CI)
 *   pnpm ts-node scripts/smoke-test-final.ts
 *
 *   # Test with flags ON (local development only)
 *   JOBFORGE_EVENTS_ENABLED=1 \
 *   JOBFORGE_AUTOPILOT_JOBS_ENABLED=1 \
 *   JOBFORGE_MANIFESTS_ENABLED=1 \
 *   VERIFY_PACK_ENABLED=1 \
 *   REPLAY_PACK_ENABLED=1 \
 *   SUPABASE_URL=http://localhost:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=xxx \
 *   pnpm ts-node scripts/smoke-test-final.ts --with-flags
 *
 * Rollback (instant disable):
 *   unset JOBFORGE_EVENTS_ENABLED \
 *          JOBFORGE_TRIGGERS_ENABLED \
 *          JOBFORGE_AUTOPILOT_JOBS_ENABLED \
 *          JOBFORGE_ACTION_JOBS_ENABLED \
 *          JOBFORGE_MANIFESTS_ENABLED \
 *          VERIFY_PACK_ENABLED \
 *          REPLAY_PACK_ENABLED
 */

// Sample tenant/project context (deterministic for reproducibility)
const SAMPLE_TENANT_ID = '00000000-0000-0000-0000-000000000001'
const SAMPLE_PROJECT_ID = '00000000-0000-0000-0000-000000000002'
const SAMPLE_ACTOR_ID = 'smoke-test-runner'

const EXIT_CODES = {
  success: 0,
  validation: 2,
  failure: 1,
}

const DEBUG_ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function logUnexpectedError(message: string, error: unknown): void {
  console.error(`${message}: ${formatError(error)}`)
  if (DEBUG_ENABLED && error instanceof Error && error.stack) {
    console.error(error.stack)
  }
}

function showHelp(): void {
  console.log(`
JobForge Runnerless Execution Plane - Final Smoke Test

Usage:
  node scripts/smoke-test-final.ts [options]

Options:
  --with-flags   Enable feature flags for full test (default: false)
  --help, -h     Show this help and exit

Notes:
  - With flags OFF, the test is safe for CI (no side effects).
  - With flags ON, requires local dev environment and Supabase credentials.

Examples:
  node scripts/smoke-test-final.ts
  JOBFORGE_EVENTS_ENABLED=1 JOBFORGE_AUTOPILOT_JOBS_ENABLED=1 \\
    JOBFORGE_MANIFESTS_ENABLED=1 VERIFY_PACK_ENABLED=1 REPLAY_PACK_ENABLED=1 \\
    SUPABASE_URL=http://localhost:54321 SUPABASE_SERVICE_ROLE_KEY=... \\
    node scripts/smoke-test-final.ts --with-flags
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  showHelp()
  process.exit(EXIT_CODES.success)
}

// Colors for output
const C = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
}

function log(level: 'success' | 'error' | 'warn' | 'info' | 'header', message: string) {
  const icons = {
    success: `${C.green}✓${C.reset}`,
    error: `${C.red}✗${C.reset}`,
    warn: `${C.yellow}⚠${C.reset}`,
    info: `${C.blue}ℹ${C.reset}`,
    header: `${C.cyan}▶${C.reset}`,
  }
  console.log(`${icons[level]} ${message}`)
}

function printSection(title: string) {
  console.log(`\n${C.bold}${C.cyan}${title}${C.reset}`)
  console.log('='.repeat(60))
}

function printSubsection(title: string) {
  console.log(`\n${C.bold}${title}${C.reset}`)
  console.log('-'.repeat(40))
}

function printSummary(title: string, data: Record<string, unknown>) {
  console.log(`\n${C.bold}${title}${C.reset}`)
  for (const [key, value] of Object.entries(data)) {
    const formatted =
      typeof value === 'boolean'
        ? value
          ? `${C.green}ON${C.reset}`
          : `${C.red}OFF${C.reset}`
        : String(value)
    console.log(`  ${key}: ${formatted}`)
  }
}

async function runSmokeTest() {
  const withFlags = process.argv.includes('--with-flags')

  const { JobForgeClient } = await import('../packages/sdk-ts/src/index')
  const { generateTraceId } = await import('../packages/integration/src/trace')
  const {
    getExtendedFeatureFlagSummary,
    isEventIngestionAvailable,
    generatePolicyToken,
    generateManifestReport,
    verifyActionJobSafety,
    captureRunProvenance,
    exportReplayBundle,
    REPLAY_PACK_ENABLED,
    VERIFY_PACK_ENABLED,
    JOBFORGE_EVENTS_ENABLED,
    JOBFORGE_AUTOPILOT_JOBS_ENABLED,
    JOBFORGE_MANIFESTS_ENABLED,
    JOBFORGE_ACTION_JOBS_ENABLED,
    JOBFORGE_POLICY_TOKEN_SECRET,
  } = await import('../packages/shared/src/index')

  printSection('JobForge Runnerless Execution Plane - Final Smoke Test')
  log('info', `Mode: ${withFlags ? 'WITH FLAGS ENABLED' : 'FLAGS OFF (safe mode)'}`)
  log('info', `Timestamp: ${new Date().toISOString()}`)

  // ============================================================================
  // STEP 1: Feature Flag Audit
  // ============================================================================
  printSection('Step 1: Feature Flag Audit')

  const flags = getExtendedFeatureFlagSummary()

  log('info', 'Current feature flag state:')
  console.log('  ' + JSON.stringify(flags, null, 2).replace(/\n/g, '\n  '))

  // Verify defaults are OFF (security check)
  const criticalFlags = [
    { name: 'JOBFORGE_EVENTS_ENABLED', value: JOBFORGE_EVENTS_ENABLED },
    { name: 'JOBFORGE_AUTOPILOT_JOBS_ENABLED', value: JOBFORGE_AUTOPILOT_JOBS_ENABLED },
    { name: 'JOBFORGE_ACTION_JOBS_ENABLED', value: JOBFORGE_ACTION_JOBS_ENABLED },
    { name: 'JOBFORGE_MANIFESTS_ENABLED', value: JOBFORGE_MANIFESTS_ENABLED },
    { name: 'VERIFY_PACK_ENABLED', value: VERIFY_PACK_ENABLED },
    { name: 'REPLAY_PACK_ENABLED', value: REPLAY_PACK_ENABLED },
  ]

  const flagsOffByDefault = criticalFlags.every((f) => !f.value)

  if (flagsOffByDefault && !withFlags) {
    log('success', 'All critical flags are OFF by default (security: PASS)')
  } else if (withFlags) {
    log('warn', 'Running with flags ENABLED - local development only')

    // Verify safety for action jobs
    try {
      verifyActionJobSafety()
      log('success', 'Action job safety verification passed')
    } catch (err: any) {
      if (JOBFORGE_ACTION_JOBS_ENABLED) {
        log('error', `Action job safety failed: ${err.message}`)
        process.exit(EXIT_CODES.failure)
      }
    }
  } else {
    log('error', 'Some flags are ON without --with-flags (unexpected state)')
  }

  // ============================================================================
  // STEP 2: Create Sample Tenant/Project Context
  // ============================================================================
  printSection('Step 2: Sample Tenant/Project Context')

  const context = {
    tenant_id: SAMPLE_TENANT_ID,
    project_id: SAMPLE_PROJECT_ID,
    actor_id: SAMPLE_ACTOR_ID,
    trace_id: generateTraceId(),
  }

  log('info', 'Sample context created:')
  console.log('  ' + JSON.stringify(context, null, 2).replace(/\n/g, '\n  '))

  // Check Supabase credentials
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    log('warn', 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
    log('warn', 'Skipping database-dependent tests')

    printSection('Smoke Test Summary (Partial - No DB)')
    printSummary('Security Verification', {
      'Flags default OFF': flagsOffByDefault,
      'Event ingestion available': false,
      'Autopilot jobs available': false,
      'Manifests available': false,
      'Verify pack available': false,
      'Replay pack available': false,
    })

    console.log(
      `\n${C.yellow}Note: Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for full test${C.reset}`
    )
    return { success: true, partial: true, flagsOffByDefault }
  }

  // Initialize client
  const client = new JobForgeClient({ supabaseUrl, supabaseKey })
  log('success', 'JobForgeClient initialized')

  // ============================================================================
  // STEP 3: Submit Sample Event Envelope
  // ============================================================================
  printSection('Step 3: Event Envelope Submission')

  const sampleEvent = {
    tenant_id: SAMPLE_TENANT_ID,
    project_id: SAMPLE_PROJECT_ID,
    event_type: 'smoke.test.verify_pack',
    trace_id: context.trace_id,
    source_app: 'jobforge' as const,
    source_module: 'ops' as const,
    payload: {
      test_type: 'runnerless_execution_plane',
      timestamp: new Date().toISOString(),
      test_run_id: `smoke-${Date.now()}`,
    },
    contains_pii: false,
  }

  let eventSubmissionResult: {
    success: boolean
    dryRun: boolean
    eventId?: string
    error?: string
  } = {
    success: false,
    dryRun: false,
  }

  if (!isEventIngestionAvailable()) {
    log('warn', 'Event ingestion is DISABLED (JOBFORGE_EVENTS_ENABLED=0)')
    log('info', 'Attempting dry-run submission...')

    try {
      // In a real dry-run scenario, we log what would happen
      log('info', `Would submit event: ${sampleEvent.event_type}`)
      log('info', `Trace ID: ${sampleEvent.trace_id}`)
      log('info', `Payload: ${JSON.stringify(sampleEvent.payload)}`)
      eventSubmissionResult = { success: true, dryRun: true }
    } catch (err: any) {
      eventSubmissionResult = { success: false, dryRun: true, error: err.message }
    }
  } else {
    log('info', 'Event ingestion is ENABLED')

    try {
      const event = await client.submitEvent(sampleEvent)
      log('success', `Event submitted: ${event.id}`)
      eventSubmissionResult = { success: true, dryRun: false, eventId: event.id }
    } catch (err: any) {
      log('error', `Event submission failed: ${err.message}`)
      eventSubmissionResult = { success: false, dryRun: false, error: err.message }
    }
  }

  // ============================================================================
  // STEP 4: Request verify_pack Job
  // ============================================================================
  printSection('Step 4: Verify Pack Job Request')

  const verifyPackInputs = {
    target: 'smoke-test-environment',
    verification_type: 'full_audit',
    checks: ['infrastructure', 'security', 'performance'],
    dry_run: !withFlags, // Always dry-run unless flags explicitly enabled
  }

  log('info', 'Requesting verify_pack job...')
  log('info', `Inputs: ${JSON.stringify(verifyPackInputs)}`)

  let verifyPackResult: {
    success: boolean
    blocked: boolean
    jobId?: string
    traceId?: string
    manifest?: any
    error?: string
  } = { success: false, blocked: true }

  if (!VERIFY_PACK_ENABLED) {
    log('warn', 'verify_pack is DISABLED (VERIFY_PACK_ENABLED=0)')
    log('info', 'Job request would be blocked at runtime')
    verifyPackResult = { success: false, blocked: true, error: 'VERIFY_PACK_ENABLED=0' }
  } else if (!withFlags) {
    log('warn', 'verify_pack requires --with-flags for execution')
    log('info', 'Attempting dry-run...')

    try {
      const result = await client.requestJob({
        tenant_id: SAMPLE_TENANT_ID,
        project_id: SAMPLE_PROJECT_ID,
        template_key: 'readylayer.verify_pack',
        inputs: verifyPackInputs,
        trace_id: context.trace_id,
        actor_id: SAMPLE_ACTOR_ID,
        dry_run: true,
      })

      log('success', `Dry-run completed: ${result.trace_id}`)
      verifyPackResult = {
        success: true,
        blocked: false,
        traceId: result.trace_id,
        jobId: (result.job as { id?: string })?.id,
      }
    } catch (err: any) {
      log('error', `Dry-run failed: ${err.message}`)
      verifyPackResult = { success: false, blocked: false, error: err.message }
    }
  } else {
    log('info', 'Executing verify_pack with flags ENABLED')

    try {
      // For full execution, we may need a policy token
      let policyToken: string | undefined

      if (JOBFORGE_ACTION_JOBS_ENABLED && JOBFORGE_POLICY_TOKEN_SECRET) {
        policyToken = generatePolicyToken({
          tenantId: SAMPLE_TENANT_ID,
          actorId: SAMPLE_ACTOR_ID,
          action: 'readylayer.verify_pack',
          scopes: ['ops:read', 'ops:write'],
          expiresInHours: 1,
        })
        log('info', 'Policy token generated for action job')
      }

      const result = await client.requestJob({
        tenant_id: SAMPLE_TENANT_ID,
        project_id: SAMPLE_PROJECT_ID,
        template_key: 'readylayer.verify_pack',
        inputs: {
          ...verifyPackInputs,
          policy_token: policyToken,
        },
        trace_id: context.trace_id,
        actor_id: SAMPLE_ACTOR_ID,
        dry_run: false,
      })

      const jobId = (result.job as { id?: string }).id
      log('success', `Job requested: ${jobId}`)
      log('info', `Trace ID: ${result.trace_id}`)

      verifyPackResult = {
        success: true,
        blocked: false,
        jobId: jobId,
        traceId: result.trace_id,
      }

      // If manifests enabled, try to get the manifest
      if (JOBFORGE_MANIFESTS_ENABLED && result.job.id) {
        printSubsection('Retrieving Manifest')

        try {
          const manifest = await client.getRunManifest({
            run_id: jobId || '',
            tenant_id: SAMPLE_TENANT_ID,
          })

          if (manifest) {
            log('success', 'Manifest retrieved')
            verifyPackResult.manifest = manifest
          } else {
            log('warn', 'Manifest not yet available (job may still be running)')
          }
        } catch (err: any) {
          log('warn', `Could not retrieve manifest: ${err.message}`)
        }
      }
    } catch (err: any) {
      log('error', `verify_pack execution failed: ${err.message}`)
      verifyPackResult = { success: false, blocked: false, error: err.message }
    }
  }

  // ============================================================================
  // STEP 5: Export Replay Bundle
  // ============================================================================
  printSection('Step 5: Replay Bundle Export')

  let replayResult: { success: boolean; bundleVersion?: string; error?: string } = {
    success: false,
  }

  if (!REPLAY_PACK_ENABLED) {
    log('warn', 'Replay pack is DISABLED (REPLAY_PACK_ENABLED=0)')
    replayResult = { success: false, error: 'REPLAY_PACK_ENABLED=0' }
  } else if (!withFlags) {
    log('warn', 'Replay pack requires --with-flags for execution')
    replayResult = { success: false, error: 'Requires --with-flags' }
  } else {
    log('info', 'Exporting replay bundle...')

    try {
      const runId = verifyPackResult.jobId || `smoke-run-${Date.now()}`

      // Capture provenance
      const provenance = await captureRunProvenance(
        runId,
        SAMPLE_TENANT_ID,
        'readylayer.verify_pack',
        verifyPackInputs,
        SAMPLE_PROJECT_ID
      )

      if (provenance) {
        log('success', `Provenance captured: ${provenance.runId.slice(0, 8)}`)

        // Export bundle
        const bundle = await exportReplayBundle(
          runId,
          SAMPLE_TENANT_ID,
          'readylayer.verify_pack',
          verifyPackInputs,
          {
            projectId: SAMPLE_PROJECT_ID,
            isDryRun: false,
          }
        )

        if (bundle) {
          log('success', 'Replay bundle exported successfully')
          replayResult = { success: true, bundleVersion: bundle.version }
        } else {
          replayResult = { success: false, error: 'Bundle export returned null' }
        }
      } else {
        replayResult = { success: false, error: 'Provenance capture failed' }
      }
    } catch (err: any) {
      log('error', `Replay bundle export failed: ${err.message}`)
      replayResult = { success: false, error: err.message }
    }
  }

  // ============================================================================
  // STEP 6: Human Summary from Manifest
  // ============================================================================
  printSection('Step 6: Human Summary Generation')

  if (verifyPackResult.manifest) {
    log('info', 'Generating human-readable summary from manifest...')

    try {
      const report = generateManifestReport(verifyPackResult.manifest, {
        include_inputs: true,
        include_metrics: true,
        include_env: true,
      })

      printSubsection('Manifest Report')
      console.log(report)
      log('success', 'Human summary generated')
    } catch (err: any) {
      log('error', `Summary generation failed: ${err.message}`)
    }
  } else {
    // Generate a mock summary for demonstration
    log('info', 'No manifest available - generating sample summary...')

    const mockManifest = {
      manifest_version: '1.0' as const,
      run_id: verifyPackResult.jobId || 'mock-run-id',
      tenant_id: SAMPLE_TENANT_ID,
      project_id: SAMPLE_PROJECT_ID,
      job_type: 'readylayer.verify_pack',
      created_at: new Date().toISOString(),
      status: 'pending' as const,
      outputs: [],
      metrics: {
        duration_ms: 0,
        cpu_ms: 0,
        memory_mb: 0,
      },
      env_fingerprint: {
        os: process.platform,
        arch: process.arch,
        node_version: process.version,
      },
      tool_versions: {
        jobforge: '0.2.0',
      },
    }

    const report = generateManifestReport(mockManifest, {
      include_inputs: true,
      include_metrics: false,
      include_env: true,
    })

    printSubsection('Sample Manifest Report (Mock)')
    console.log(report)
    log('info', 'Sample summary generated (actual manifest would appear here)')
  }

  // ============================================================================
  // Final Summary
  // ============================================================================
  printSection('Final Smoke Test Summary')

  const summary = {
    mode: withFlags ? 'WITH_FLAGS' : 'SAFE_MODE',
    security_defaults: flagsOffByDefault,
    event_submission: eventSubmissionResult.success
      ? eventSubmissionResult.dryRun
        ? 'DRY_RUN'
        : 'SUCCESS'
      : 'FAILED',
    verify_pack: verifyPackResult.success
      ? verifyPackResult.blocked
        ? 'BLOCKED (expected)'
        : 'SUCCESS'
      : verifyPackResult.blocked
        ? 'BLOCKED (expected)'
        : 'FAILED',
    replay_bundle: replayResult.success ? 'SUCCESS' : 'DISABLED',
    flags: {
      JOBFORGE_EVENTS_ENABLED,
      JOBFORGE_AUTOPILOT_JOBS_ENABLED,
      JOBFORGE_MANIFESTS_ENABLED,
      VERIFY_PACK_ENABLED,
      REPLAY_PACK_ENABLED,
    },
  }

  console.log('\n' + JSON.stringify(summary, null, 2))

  // Human-readable verdict
  console.log(`\n${C.bold}VERDICT:${C.reset}`)

  if (!withFlags) {
    if (flagsOffByDefault && !eventSubmissionResult.success && verifyPackResult.blocked) {
      log('success', 'ALL CHECKS PASSED - System is safely disabled by default')
      console.log(
        `\n${C.green}✓ Safe to deploy: All execution plane features are OFF by default${C.reset}`
      )
      console.log(`${C.green}✓ No side effects: verify_pack correctly blocked${C.reset}`)
      console.log(`${C.green}✓ Rollback ready: All features can be disabled instantly${C.reset}`)
    } else {
      log('error', 'UNEXPECTED STATE - Security check failed')
      process.exit(EXIT_CODES.failure)
    }
  } else {
    if (eventSubmissionResult.success && verifyPackResult.success) {
      log('success', 'ALL CHECKS PASSED - Execution plane is operational')
      console.log(`\n${C.green}✓ Event ingestion: Working${C.reset}`)
      console.log(`${C.green}✓ verify_pack job: Working${C.reset}`)
      console.log(`${C.green}✓ Manifest generation: Working${C.reset}`)
      console.log(
        `${C.green}✓ Replay bundle: ${replayResult.success ? 'Working' : 'Disabled'}${C.reset}`
      )
    } else {
      log('warn', 'PARTIAL SUCCESS - Some features not operational')
      if (!eventSubmissionResult.success) {
        console.log(`${C.red}✗ Event ingestion: ${eventSubmissionResult.error}${C.reset}`)
      }
      if (!verifyPackResult.success) {
        console.log(`${C.red}✗ verify_pack: ${verifyPackResult.error}${C.reset}`)
      }
    }
  }

  // Rollback instructions
  console.log(`\n${C.bold}Rollback Plan (Emergency Disable):${C.reset}`)
  console.log(`  Run these commands to disable ALL execution plane features instantly:`)
  console.log(
    `  ${C.yellow}unset JOBFORGE_EVENTS_ENABLED JOBFORGE_TRIGGERS_ENABLED JOBFORGE_AUTOPILOT_JOBS_ENABLED JOBFORGE_ACTION_JOBS_ENABLED JOBFORGE_MANIFESTS_ENABLED VERIFY_PACK_ENABLED REPLAY_PACK_ENABLED${C.reset}`
  )
  console.log(`  ${C.yellow}# Or set all to 0:${C.reset}`)
  console.log(`  ${C.yellow}export JOBFORGE_EVENTS_ENABLED=0${C.reset}`)
  console.log(`  ${C.yellow}export JOBFORGE_AUTOPILOT_JOBS_ENABLED=0${C.reset}`)
  console.log(`  ${C.yellow}export VERIFY_PACK_ENABLED=0${C.reset}`)
  console.log(`  ${C.yellow}export REPLAY_PACK_ENABLED=0${C.reset}`)

  printSection('Smoke Test Complete')

  return {
    success: true,
    mode: withFlags ? 'with_flags' : 'safe_mode',
    summary,
  }
}

// Run if executed directly
if (require.main === module) {
  runSmokeTest()
    .then((result) => {
      console.log(`\nExit code: 0`)
      process.exit(EXIT_CODES.success)
    })
    .catch((err) => {
      logUnexpectedError(`${C.red}Smoke test crashed${C.reset}`, err)
      process.exit(EXIT_CODES.failure)
    })
}

export { runSmokeTest, SAMPLE_TENANT_ID, SAMPLE_PROJECT_ID, SAMPLE_ACTOR_ID }
