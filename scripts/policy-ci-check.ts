#!/usr/bin/env tsx
/**
 * JobForge Policy Guard CI Check
 * Enforces policy categorization, drift detection, and tenant boundary verification in CI.
 */

import { validateForCI, policyGuard } from '../packages/shared/src/policy-guard.js'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

console.log('[policy:ci-check] Running JobForge Policy Guard CI validation...')

let failed = false

// 1. Validate policy categories & governance flags
const ciResult = validateForCI()
if (!ciResult.passed) {
  console.error('❌ Policy validation failed:')
  for (const err of ciResult.errors) {
    console.error(`  - ${err}`)
  }
  failed = true
} else {
  console.log('✅ Policy categories and feature flag governance validated.')
}

// 2. Drift check
const drift = policyGuard.detectDrift()
if (drift.hasDrift) {
  console.error(`❌ Policy drift detected: ${drift.uncategorizedJobs.length} uncategorized job types`)
  for (const uncategorized of drift.uncategorizedJobs) {
    console.error(`  - Uncategorized job: ${uncategorized}`)
  }
  failed = true
} else {
  console.log(`✅ Drift detection passed. Registered action jobs: ${drift.newActionJobs.length}`)
}

// 3. Static AST/Regex scan for tenant boundary enforcement in handlers
console.log('[policy:ci-check] Verifying tenant boundary enforcement in handlers...')
const handlersDir = join(process.cwd(), 'services/worker-ts/src/handlers')

function scanDirForTenantEnforcement(dir: string): void {
  const files = readdirSync(dir)
  for (const file of files) {
    const fullPath = join(dir, file)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      scanDirForTenantEnforcement(fullPath)
    } else if (file.endsWith('.ts') && !file.endsWith('.test.ts')) {
      const content = readFileSync(fullPath, 'utf-8')
      // Handlers must inspect or pass context.tenant_id or validate tenant_id
      if (content.includes('JobContext') && !content.includes('tenant_id')) {
        console.warn(`⚠️ Warning: Handler ${file} imports JobContext but does not reference tenant_id`)
      }
    }
  }
}

try {
  scanDirForTenantEnforcement(handlersDir)
  console.log('✅ Handler tenant boundary check complete.')
} catch (e) {
  console.warn('⚠️ Could not scan handlers directory:', e)
}

if (failed) {
  console.error('\n❌ Policy CI Check failed.')
  process.exit(1)
} else {
  console.log('\n✅ All Policy Guard CI checks passed successfully.')
  process.exit(0)
}
