#!/usr/bin/env tsx
/**
 * E2E Smoke Test Runner
 *
 * Run this script to execute smoke tests locally:
 *   tsx scripts/e2e-smoke-runner.ts
 *
 * Or with pnpm:
 *   pnpm tsx scripts/e2e-smoke-runner.ts
 */

import {
  runSmokeMatrix,
  formatSmokeMatrixResults,
} from '../packages/shared/test/e2e/smoke-matrix.js'
import {
  runFailureInjectionTests,
  formatFailureInjectionResults,
  verifyErrorStates,
} from '../packages/shared/test/e2e/failure-injection.js'

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗')
  console.log('║         JOBFORGE E2E SMOKE TEST RUNNER                   ║')
  console.log('╚══════════════════════════════════════════════════════════╝')
  console.log('')

  // Check environment
  const hasEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

  if (!hasEnv) {
    console.log('⚠️  Missing environment variables:')
    console.log('   - SUPABASE_URL')
    console.log('   - SUPABASE_SERVICE_ROLE_KEY')
    console.log('')
    console.log('E2E tests will run in dry-run mode (tests will be skipped)')
    console.log('')
  }

  let exitCode = 0

  try {
    // Phase 1: Smoke Matrix
    console.log('📋 Phase 1: Running Smoke Matrix...')
    console.log('')

    const smokeResults = await runSmokeMatrix()
    console.log(formatSmokeMatrixResults(smokeResults))
    console.log('')

    if (!smokeResults.overallHealthy) {
      console.log('⚠️  Smoke matrix detected unhealthy components')
      exitCode = 1
    }

    // Phase 2: Failure Injection
    console.log('💉 Phase 2: Running Failure Injection Tests...')
    console.log('')

    const failureResults = await runFailureInjectionTests()
    console.log(formatFailureInjectionResults(failureResults))
    console.log('')

    // Phase 3: Error State Verification
    console.log('🔍 Phase 3: Verifying Error States...')
    console.log('')

    const verification = verifyErrorStates(failureResults)

    if (verification.valid) {
      console.log('✅ All error states are valid:')
      console.log('   - No hard-500s detected')
      console.log('   - All errors are recoverable')
      console.log('   - All errors are actionable')
    } else {
      console.log('❌ Error state verification failed:')
      for (const issue of verification.issues) {
        console.log(`   - ${issue}`)
      }
      exitCode = 1
    }
    console.log('')

    // Final Summary
    console.log('╔══════════════════════════════════════════════════════════╗')
    console.log('║                    FINAL SUMMARY                         ║')
    console.log('╚══════════════════════════════════════════════════════════╝')
    console.log('')
    console.log(`Smoke Matrix:     ${smokeResults.overallHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`)
    console.log(
      `Services:         ${smokeResults.services.filter((s) => s.healthy).length}/${smokeResults.services.length} healthy`
    )
    console.log(
      `Runners:          ${smokeResults.runners.filter((r) => r.callable).length}/${smokeResults.runners.length} callable`
    )
    console.log(
      `Truthcore:        ${smokeResults.truthcore.reachable ? '✅' : '❌'} reachable, ${smokeResults.truthcore.deterministic ? '✅' : '❌'} deterministic`
    )
    console.log(`Failure Tests:    ${failureResults.length} scenarios tested`)
    console.log(`Error States:     ${verification.valid ? '✅ VALID' : '❌ INVALID'}`)
    console.log('')

    if (exitCode === 0) {
      console.log('🎉 All E2E tests passed!')
    } else {
      console.log('⚠️  Some E2E tests failed. Review the output above.')
    }
  } catch (error) {
    console.error('❌ E2E test runner failed:', error)
    exitCode = 1
  }

  process.exit(exitCode)
}

main()
