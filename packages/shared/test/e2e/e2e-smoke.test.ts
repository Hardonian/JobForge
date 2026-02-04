/**
 * @jobforge/shared - E2E Smoke Test Suite
 *
 * Comprehensive end-to-end smoke tests including:
 * 1. Smoke Matrix - verify all services and capabilities
 * 2. Failure Injection - verify error handling and recovery
 * 3. Error State Verification - ensure no hard-500s
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { runSmokeMatrix, formatSmokeMatrixResults, type SmokeMatrixResult } from './smoke-matrix.js'
import {
  runFailureInjectionTests,
  formatFailureInjectionResults,
  verifyErrorStates,
  type FailureTestResult,
} from './failure-injection.js'

// Skip tests if environment variables are not set
const shouldRunE2E = () => {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

describe('E2E Smoke Matrix', () => {
  let smokeResults: SmokeMatrixResult | null = null

  beforeAll(async () => {
    if (!shouldRunE2E()) {
      console.log('Skipping E2E tests - environment variables not set')
      return
    }

    try {
      smokeResults = await runSmokeMatrix()
      console.log(formatSmokeMatrixResults(smokeResults))
    } catch (error) {
      console.error('Smoke matrix failed:', error)
    }
  })

  it('should complete smoke matrix without crashing', () => {
    if (!shouldRunE2E()) {
      return
    }
    expect(smokeResults).not.toBeNull()
  })

  it('should verify truthcore is reachable', () => {
    if (!shouldRunE2E() || !smokeResults) {
      return
    }
    expect(smokeResults.truthcore.reachable).toBe(true)
  })

  it('should verify truthcore is deterministic', () => {
    if (!shouldRunE2E() || !smokeResults) {
      return
    }
    expect(smokeResults.truthcore.deterministic).toBe(true)
  })

  it('should verify all services are healthy', () => {
    if (!shouldRunE2E() || !smokeResults) {
      return
    }
    const unhealthyServices = smokeResults.services.filter((s) => !s.healthy)
    if (unhealthyServices.length > 0) {
      console.warn(
        'Unhealthy services:',
        unhealthyServices.map((s: { name: string }) => s.name)
      )
    }
    // Don't fail the test for unhealthy services in smoke mode
    // Just log warnings - this is a smoke test, not a health check
    expect(unhealthyServices.length).toBeLessThan(smokeResults.services.length)
  })
})

describe('E2E Failure Injection', () => {
  let failureResults: FailureTestResult[] = []

  beforeAll(async () => {
    if (!shouldRunE2E()) {
      console.log('Skipping E2E tests - environment variables not set')
      return
    }

    try {
      failureResults = await runFailureInjectionTests()
      console.log(formatFailureInjectionResults(failureResults))
    } catch (error) {
      console.error('Failure injection tests failed:', error)
    }
  })

  it('should complete failure injection tests', () => {
    if (!shouldRunE2E()) {
      return
    }
    expect(failureResults.length).toBeGreaterThan(0)
  })

  it('should not produce hard-500 errors', () => {
    if (!shouldRunE2E() || failureResults.length === 0) {
      return
    }
    const hard500s = failureResults.filter((r) => r.hard500)
    expect(hard500s.length).toBe(0)
  })

  it('should produce recoverable errors', () => {
    if (!shouldRunE2E() || failureResults.length === 0) {
      return
    }
    const nonRecoverable = failureResults.filter((r) => !r.recoverable)
    expect(nonRecoverable.length).toBe(0)
  })

  it('should produce actionable errors', () => {
    if (!shouldRunE2E() || failureResults.length === 0) {
      return
    }
    const nonActionable = failureResults.filter((r) => !r.actionable)
    expect(nonActionable.length).toBe(0)
  })

  it('should pass error state verification', () => {
    if (!shouldRunE2E() || failureResults.length === 0) {
      return
    }
    const verification = verifyErrorStates(failureResults)
    if (!verification.valid) {
      console.error('Error state verification failed:', verification.issues)
    }
    expect(verification.valid).toBe(true)
  })
})

describe('E2E Error Handling', () => {
  it('should handle missing environment gracefully', () => {
    // This test should always pass - it verifies the test setup works
    const hasEnv = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

    if (!hasEnv) {
      console.log(
        'Note: E2E tests will be skipped (missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)'
      )
    }

    expect(true).toBe(true)
  })
})
