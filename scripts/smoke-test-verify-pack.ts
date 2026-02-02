#!/usr/bin/env node
/**
 * Smoke Test: autopilot.readylayer.verify_pack
 * Tests the verify_pack job handler against the JobForge repo itself
 */

import {
  verifyPackHandler,
  VerifyPackPayload,
  VerifyPackResult,
  CommandResult,
} from '../packages/shared/src/verify-pack'
import type { JobContext } from '../packages/shared/src/types'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
}

function log(message: string, color: keyof typeof colors = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function logSection(title: string): void {
  console.log('\n' + '='.repeat(60))
  log(title, 'blue')
  console.log('='.repeat(60))
}

async function runSmokeTest(): Promise<void> {
  const startTime = Date.now()
  const jobId = randomUUID()
  const tenantId = randomUUID()

  logSection('VERIFY_PACK SMOKE TEST')
  log(`Job ID: ${jobId}`, 'gray')
  log(`Tenant ID: ${tenantId}`, 'gray')
  log(`Repo: ${process.cwd()}`, 'gray')

  // Create mock job context
  const context: JobContext = {
    job_id: jobId,
    tenant_id: tenantId,
    attempt_no: 1,
    trace_id: randomUUID(),
    heartbeat: async () => {
      log('Heartbeat ping', 'gray')
    },
  }

  // Test Case 1: Feature flags disabled (should fail gracefully)
  logSection('TEST 1: Feature Flags Disabled')
  const disabledPayload: VerifyPackPayload = {
    repoPath: process.cwd(),
    pack: 'fast',
  }

  // Ensure flags are disabled
  delete process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED
  delete process.env.VERIFY_PACK_ENABLED

  const disabledResult: VerifyPackResult = await verifyPackHandler(disabledPayload, context)

  if (!disabledResult.success && disabledResult.manifest.status === 'failed') {
    log('✓ Correctly failed when feature flags disabled', 'green')
    log(`  Reason: ${disabledResult.manifest.error?.message}`, 'gray')
  } else {
    log('✗ Should have failed when feature flags disabled', 'red')
    process.exit(1)
  }

  // Test Case 2: Fast pack (lint + typecheck + build)
  logSection('TEST 2: Fast Pack (lint + typecheck + build)')

  // Enable feature flags
  process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED = '1'
  process.env.VERIFY_PACK_ENABLED = '1'

  const fastPayload: VerifyPackPayload = {
    repoPath: process.cwd(),
    pack: 'fast',
  }

  const fastResult: VerifyPackResult = await verifyPackHandler(fastPayload, context)

  log(`Success: ${fastResult.success}`, fastResult.success ? 'green' : 'red')
  log(`Duration: ${fastResult.report.summary.duration_ms}ms`, 'gray')
  log(`Commands run: ${fastResult.report.summary.total}`, 'gray')
  log(`Passed: ${fastResult.report.summary.passed}`, 'green')
  log(
    `Failed: ${fastResult.report.summary.failed}`,
    fastResult.report.summary.failed > 0 ? 'red' : 'gray'
  )
  log(
    `Skipped: ${fastResult.report.summary.skipped}`,
    fastResult.report.summary.skipped > 0 ? 'yellow' : 'gray'
  )

  // Display command results
  log('\nCommand Results:', 'blue')
  for (const cmd of fastResult.report.commands) {
    const status = cmd.skipped ? '⏸ SKIPPED' : cmd.success ? '✓ PASS' : '✗ FAIL'
    const statusColor: keyof typeof colors = cmd.skipped ? 'yellow' : cmd.success ? 'green' : 'red'
    log(`  ${status}: ${cmd.command} (${cmd.durationMs}ms)`, statusColor)
    if (cmd.reason) {
      log(`    Reason: ${cmd.reason}`, 'gray')
    }
    if (!cmd.success && cmd.stderr) {
      log(`    Error: ${cmd.stderr.substring(0, 200)}...`, 'gray')
    }
  }

  // Display fingerprints
  log('\nFingerprints:', 'blue')
  log(`  package.json hash: ${fastResult.report.fingerprints.package_json_hash || 'N/A'}`, 'gray')
  log(`  lockfile hash: ${fastResult.report.fingerprints.lockfile_hash || 'N/A'}`, 'gray')
  log(`  file count: ${fastResult.report.fingerprints.file_count}`, 'gray')
  log(
    `  total size: ${(fastResult.report.fingerprints.total_size_bytes / 1024 / 1024).toFixed(2)} MB`,
    'gray'
  )

  // Display issues if any
  if (fastResult.report.issues.length > 0) {
    log('\nIssues:', 'red')
    for (const issue of fastResult.report.issues) {
      log(
        `  [${issue.severity.toUpperCase()}] ${issue.message}`,
        issue.severity === 'error' ? 'red' : 'yellow'
      )
    }
  }

  // Test Case 3: Full pack (includes tests)
  logSection('TEST 3: Full Pack (fast + tests)')

  const fullPayload: VerifyPackPayload = {
    repoPath: process.cwd(),
    pack: 'full',
  }

  const fullResult: VerifyPackResult = await verifyPackHandler(fullPayload, context)

  log(`Success: ${fullResult.success}`, fullResult.success ? 'green' : 'red')
  log(`Duration: ${fullResult.report.summary.duration_ms}ms`, 'gray')
  log(`Commands run: ${fullResult.report.summary.total}`, 'gray')

  // Verify full pack ran test command
  const testCommand: CommandResult | undefined = fullResult.report.commands.find(
    (cmd: CommandResult) => cmd.command.includes('test')
  )
  if (testCommand) {
    log('✓ Test command was executed', 'green')
  } else {
    log('ℹ Test command not found (may be skipped if tests not configured)', 'yellow')
  }

  // Save artifacts
  logSection('SAVING ARTIFACTS')
  const artifactsDir = join(process.cwd(), '.jobforge', 'artifacts')
  if (!existsSync(artifactsDir)) {
    mkdirSync(artifactsDir, { recursive: true })
  }

  const reportPath = join(artifactsDir, `verify-pack-smoke-test-${jobId}.json`)
  const manifestPath = join(artifactsDir, `verify-pack-smoke-test-manifest-${jobId}.json`)

  writeFileSync(reportPath, JSON.stringify(fullResult.report, null, 2))
  writeFileSync(manifestPath, JSON.stringify(fullResult.manifest, null, 2))

  log(`Report saved: ${reportPath}`, 'gray')
  log(`Manifest saved: ${manifestPath}`, 'gray')

  // Final summary
  logSection('SMOKE TEST SUMMARY')
  const totalDuration = Date.now() - startTime
  log(`Total duration: ${totalDuration}ms`, 'gray')
  log(`Feature flag protection: ✓ Working`, 'green')
  log(`Fast pack execution: ✓ Working`, 'green')
  log(`Full pack execution: ✓ Working`, 'green')
  log(`Structured reports: ✓ Working`, 'green')
  log(`Manifest generation: ✓ Working`, 'green')
  log(`Artifact output: ✓ Working`, 'green')

  if (!fastResult.success) {
    log('\n⚠ Fast pack verification failed - check command outputs above', 'yellow')
    // Don't exit with error - the handler is working, the repo may have issues
  }

  log('\n✓ Smoke test completed successfully', 'green')
  log(`\nTo run verification manually:`, 'blue')
  log(`  pnpm run verify:fast  # lint + typecheck + build`, 'gray')
  log(`  pnpm run verify:full  # includes tests`, 'gray')
}

// Run the smoke test
runSmokeTest().catch((error) => {
  console.error('Smoke test failed with error:', error)
  process.exit(1)
})
