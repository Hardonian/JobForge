#!/usr/bin/env tsx
/**
 * JobForge Doctor CLI
 *
 * Commands:
 *   check       - Run all health checks (default)
 *   check --json - Output JSON for machine parsing
 *   check --apply - Attempt to apply fixes (requires confirmation)
 *
 * Environment:
 *   JOBFORGE_DOCTOR_ENABLED=1 - Required for doctor to run
 *   SUPABASE_URL - Database connection
 *   SUPABASE_SERVICE_ROLE_KEY - Database auth
 *
 * Usage:
 *   pnpm jobforge:doctor
 *   pnpm jobforge:doctor --json
 *   JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor
 */

import {
  runDoctor,
  formatDoctorReportHuman,
  formatDoctorReportJson,
  type DoctorReport,
} from '../packages/shared/src/doctor.js'
import { JOBFORGE_DOCTOR_ENABLED } from '../packages/shared/src/feature-flags.js'
import { execSync } from 'child_process'
import { createInterface } from 'readline'

interface DoctorOptions {
  json: boolean
  apply: boolean
  yes: boolean
}

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${message} [y/N]: `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function applyFixes(report: DoctorReport, force = false): Promise<void> {
  console.log('\nAttempting to apply fixes...\n')

  const fixesToApply: string[] = []

  // Check if we can auto-apply any fixes
  for (const check of report.checks) {
    if (check.status === 'fail' && check.fixCommand) {
      fixesToApply.push(check.fixCommand)
    }
  }

  if (fixesToApply.length === 0) {
    console.log('No auto-fixable issues found.')
    console.log('Manual fix steps are provided in the report above.')
    return
  }

  console.log(`Found ${fixesToApply.length} auto-fixable issues:`)
  for (const fix of fixesToApply) {
    console.log(`  - ${fix}`)
  }

  // Safety check: require explicit confirmation unless --yes
  if (!force) {
    const autoFixEnabled = process.env.JOBFORGE_DOCTOR_AUTO_FIX === '1'
    if (!autoFixEnabled) {
      console.log('\n⚠️  Auto-fix is disabled by default for safety.')
      console.log('Set JOBFORGE_DOCTOR_AUTO_FIX=1 to enable auto-fixes.')
      console.log('Or use --yes to confirm each fix individually.\n')
    }

    const confirmed = await confirm('Apply these fixes?')
    if (!confirmed) {
      console.log('Fixes cancelled.')
      return
    }
  }

  // Apply fixes
  for (const fix of fixesToApply) {
    try {
      console.log(`\nExecuting: ${fix}`)
      const result = execSync(fix, { encoding: 'utf-8', stdio: 'pipe' })
      console.log('✓ Success')
      if (result) {
        console.log(result.slice(0, 500)) // Limit output
      }
    } catch (error) {
      console.error(`✗ Failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  console.log('\nFixes applied. Run doctor again to verify.')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const options: DoctorOptions = {
    json: args.includes('--json'),
    apply: args.includes('--apply'),
    yes: args.includes('--yes') || args.includes('-y'),
  }

  // Check if doctor is enabled
  if (!JOBFORGE_DOCTOR_ENABLED) {
    console.error('Error: JOBFORGE_DOCTOR_ENABLED is not set to 1')
    console.error('')
    console.error('The doctor is disabled by default. To enable:')
    console.error('  export JOBFORGE_DOCTOR_ENABLED=1')
    console.error('')
    console.error('Or run with:')
    console.error('  JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor')
    console.error('')
    console.error('This safety measure prevents accidental diagnostics in production.')
    process.exit(1)
  }

  console.log('JobForge System Doctor')
  console.log('Running health checks...\n')

  try {
    const report = await runDoctor()

    // Output report
    if (options.json) {
      console.log(formatDoctorReportJson(report))
    } else {
      console.log(formatDoctorReportHuman(report))
    }

    // Apply fixes if requested
    if (options.apply && !options.json) {
      await applyFixes(report, options.yes)
    }

    // Exit with appropriate code
    process.exit(report.overallStatus === 'critical' ? 1 : 0)
  } catch (error) {
    console.error(`Doctor failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

// Show help if requested
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
JobForge Doctor CLI

Usage:
  pnpm jobforge:doctor [options]

Options:
  --json     Output machine-readable JSON
  --apply    Attempt to apply auto-fixes (requires confirmation)
  --yes, -y  Skip confirmation prompts (use with caution)
  --help     Show this help

Environment:
  JOBFORGE_DOCTOR_ENABLED=1     Required to run doctor
  JOBFORGE_DOCTOR_AUTO_FIX=1    Enable auto-fix mode
  SUPABASE_URL                  Database connection URL
  SUPABASE_SERVICE_ROLE_KEY     Database service key

Examples:
  # Run doctor check
  JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor

  # Output JSON for CI/CD
  JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor --json

  # Apply fixes with confirmation
  JOBFORGE_DOCTOR_ENABLED=1 pnpm jobforge:doctor --apply

Safety:
  - Doctor NEVER prints secrets
  - Auto-fix is disabled by default
  - Requires explicit JOBFORGE_DOCTOR_ENABLED=1
  - --apply requires confirmation unless JOBFORGE_DOCTOR_AUTO_FIX=1
`)
  process.exit(0)
}

main()
