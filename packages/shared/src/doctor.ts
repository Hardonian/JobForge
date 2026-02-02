/**
 * JobForge System Doctor
 * Self-healing diagnostics for the operator (not the app)
 * Feature flag: JOBFORGE_DOCTOR_ENABLED=1 (doctor can run)
 * Safe defaults: No auto-apply unless explicitly enabled
 */

import { execSync } from 'child_process'
import { readFile, stat, access } from 'fs/promises'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import {
  JOBFORGE_DOCTOR_ENABLED,
  getExtendedFeatureFlagSummary,
  JOBFORGE_POLICY_TOKEN_SECRET,
} from './feature-flags.js'

// ============================================================================
// Types
// ============================================================================

export interface DoctorCheck {
  name: string
  status: 'pass' | 'warn' | 'fail' | 'skip'
  message: string
  details?: Record<string, unknown>
  fixSteps?: string[]
  fixCommand?: string
}

export interface DoctorReport {
  timestamp: string
  version: string
  overallStatus: 'healthy' | 'degraded' | 'critical'
  checks: DoctorCheck[]
  summary: {
    passed: number
    warnings: number
    failed: number
    skipped: number
  }
  unsafeFlagsInProd: string[]
  fixSteps: string[]
}

// ============================================================================
// Feature Flag Check
// ============================================================================

function checkDoctorEnabled(): { canRun: boolean; reason?: string } {
  if (!JOBFORGE_DOCTOR_ENABLED) {
    return {
      canRun: false,
      reason: 'JOBFORGE_DOCTOR_ENABLED is not set. Set to 1 to enable doctor.',
    }
  }
  return { canRun: true }
}

// ============================================================================
// Individual Health Checks
// ============================================================================

async function checkNodeVersion(): Promise<DoctorCheck> {
  try {
    const nodeVersion = process.version
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10)
    const requiredMajor = 20

    if (majorVersion >= requiredMajor) {
      return {
        name: 'Node.js Version',
        status: 'pass',
        message: `Node.js ${nodeVersion} (>= ${requiredMajor}.0.0 required)`,
        details: { version: nodeVersion, required: `>=${requiredMajor}.0.0` },
      }
    }

    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `Node.js ${nodeVersion} is too old (>= ${requiredMajor}.0.0 required)`,
      details: { version: nodeVersion, required: `>=${requiredMajor}.0.0` },
      fixSteps: [
        'Install Node.js 20 or higher:',
        '  - Using nvm: nvm install 20 && nvm use 20',
        '  - Using fnm: fnm install 20 && fnm use 20',
        '  - Download from: https://nodejs.org/',
      ],
    }
  } catch (error) {
    return {
      name: 'Node.js Version',
      status: 'fail',
      message: `Failed to check Node.js version: ${error instanceof Error ? error.message : String(error)}`,
      fixSteps: ['Ensure Node.js is properly installed and in PATH'],
    }
  }
}

async function checkPnpmVersion(): Promise<DoctorCheck> {
  try {
    const pnpmVersion = execSync('pnpm --version', { encoding: 'utf-8' }).trim()
    const majorVersion = parseInt(pnpmVersion.split('.')[0], 10)
    const requiredMajor = 8

    if (majorVersion >= requiredMajor) {
      return {
        name: 'pnpm Version',
        status: 'pass',
        message: `pnpm ${pnpmVersion} (>= ${requiredMajor}.0.0 required)`,
        details: { version: pnpmVersion, required: `>=${requiredMajor}.0.0` },
      }
    }

    return {
      name: 'pnpm Version',
      status: 'fail',
      message: `pnpm ${pnpmVersion} is too old (>= ${requiredMajor}.0.0 required)`,
      details: { version: pnpmVersion, required: `>=${requiredMajor}.0.0` },
      fixSteps: [
        'Update pnpm:',
        '  - npm install -g pnpm@latest',
        '  - Or: corepack enable && corepack prepare pnpm@latest --activate',
      ],
    }
  } catch (error) {
    return {
      name: 'pnpm Version',
      status: 'fail',
      message: 'pnpm not found in PATH',
      fixSteps: [
        'Install pnpm:',
        '  - npm install -g pnpm',
        '  - Or: corepack enable (if using Node.js 16+)',
      ],
    }
  }
}

async function checkLockfile(): Promise<DoctorCheck> {
  try {
    await access('pnpm-lock.yaml')
    const stats = await stat('pnpm-lock.yaml')
    const age = Date.now() - stats.mtime.getTime()
    const ageDays = age / (1000 * 60 * 60 * 24)

    if (ageDays > 7) {
      return {
        name: 'Lockfile Presence',
        status: 'warn',
        message: `pnpm-lock.yaml exists but is ${Math.floor(ageDays)} days old`,
        details: { lastModified: stats.mtime.toISOString(), ageDays: Math.floor(ageDays) },
        fixSteps: [
          'Run: pnpm install (to update if needed)',
          'Or: pnpm update (to update dependencies)',
        ],
      }
    }

    return {
      name: 'Lockfile Presence',
      status: 'pass',
      message: 'pnpm-lock.yaml exists and is recent',
      details: { lastModified: stats.mtime.toISOString() },
    }
  } catch {
    return {
      name: 'Lockfile Presence',
      status: 'fail',
      message: 'pnpm-lock.yaml not found',
      fixSteps: ['Run: pnpm install (to generate lockfile)'],
    }
  }
}

async function checkEnvVars(): Promise<DoctorCheck> {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']
  const missing = required.filter((key) => !process.env[key])
  const present = required.filter((key) => process.env[key])

  // Redact values for safety
  const redacted = present.map((key) => {
    const value = process.env[key] || ''
    return { key, set: true, preview: value.length > 0 ? `${value.slice(0, 4)}...` : 'empty' }
  })

  if (missing.length > 0) {
    return {
      name: 'Required Environment Variables',
      status: 'fail',
      message: `Missing required env vars: ${missing.join(', ')}`,
      details: { missing, present: redacted },
      fixSteps: [
        'Create .env file or set environment variables:',
        `  - ${missing.join('\n  - ')}`,
        '',
        'Note: Secrets are never printed in doctor output.',
      ],
    }
  }

  return {
    name: 'Required Environment Variables',
    status: 'pass',
    message: `All required env vars present (${present.length} vars)`,
    details: { present: redacted },
  }
}

async function checkDbConnectivity(): Promise<DoctorCheck> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return {
      name: 'Database Connectivity',
      status: 'skip',
      message: 'Skipping - required env vars not set',
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    })

    // Test connection with a simple query
    const { data, error } = await supabase.rpc('jobforge_list_jobs', {
      p_tenant_id: '00000000-0000-0000-0000-000000000000',
      p_limit: 1,
    })

    if (error) {
      return {
        name: 'Database Connectivity',
        status: 'fail',
        message: `Database connection failed: ${error.message}`,
        fixSteps: [
          'Check SUPABASE_URL is correct',
          'Check SUPABASE_SERVICE_ROLE_KEY is valid',
          'Verify database is running and accessible',
          'Check network/firewall settings',
        ],
      }
    }

    return {
      name: 'Database Connectivity',
      status: 'pass',
      message: 'Successfully connected to database',
      details: { responseTime: 'unknown' }, // Could add timing if needed
    }
  } catch (error) {
    return {
      name: 'Database Connectivity',
      status: 'fail',
      message: `Database connection error: ${error instanceof Error ? error.message : String(error)}`,
      fixSteps: [
        'Check SUPABASE_URL format (should be https://...)',
        'Verify network connectivity',
        'Check if Supabase project is active',
      ],
    }
  }
}

async function checkMigrations(): Promise<DoctorCheck> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return {
      name: 'Database Migrations',
      status: 'skip',
      message: 'Skipping - required env vars not set',
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    })

    // Check for core tables existence
    const { data, error } = await supabase
      .from('information_schema.tables')
      .select('table_name')
      .eq('table_schema', 'public')
      .in('table_name', ['jobforge_jobs', 'jobforge_events', 'jobforge_job_templates'])

    if (error) {
      return {
        name: 'Database Migrations',
        status: 'fail',
        message: `Failed to check migrations: ${error.message}`,
      }
    }

    const expectedTables = ['jobforge_jobs', 'jobforge_events', 'jobforge_job_templates']
    const foundTables = data?.map((t) => t.table_name) || []
    const missingTables = expectedTables.filter((t) => !foundTables.includes(t))

    if (missingTables.length > 0) {
      return {
        name: 'Database Migrations',
        status: 'fail',
        message: `Missing tables: ${missingTables.join(', ')}`,
        details: { found: foundTables, missing: missingTables },
        fixSteps: [
          'Run migrations:',
          '  1. cd supabase',
          '  2. supabase db reset (if local)',
          '  3. Or apply migrations manually via SQL editor',
        ],
      }
    }

    return {
      name: 'Database Migrations',
      status: 'pass',
      message: `All core tables present (${foundTables.length} tables)`,
      details: { tables: foundTables },
    }
  } catch (error) {
    return {
      name: 'Database Migrations',
      status: 'fail',
      message: `Migration check failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function checkTriggerStatus(): Promise<DoctorCheck> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    return {
      name: 'Trigger Status',
      status: 'skip',
      message: 'Skipping - required env vars not set',
    }
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    })

    // Get trigger rules summary
    const { data: rules, error } = await supabase
      .from('jobforge_bundle_trigger_rules')
      .select('enabled, action_mode')
      .limit(100)

    if (error) {
      // Table might not exist (older migration)
      return {
        name: 'Trigger Status',
        status: 'warn',
        message: 'Could not query trigger rules table - may need migration',
      }
    }

    const enabledCount = rules?.filter((r) => r.enabled).length || 0
    const totalCount = rules?.length || 0
    const executeModeCount =
      rules?.filter((r) => r.enabled && r.action_mode === 'execute').length || 0

    if (totalCount === 0) {
      return {
        name: 'Trigger Status',
        status: 'pass',
        message: 'No trigger rules configured',
        details: { total: 0, enabled: 0, executeMode: 0 },
      }
    }

    const status = executeModeCount > 0 ? 'warn' : 'pass'
    const message =
      executeModeCount > 0
        ? `${enabledCount}/${totalCount} triggers enabled, ${executeModeCount} in EXECUTE mode`
        : `${enabledCount}/${totalCount} triggers enabled, all in DRY_RUN mode`

    return {
      name: 'Trigger Status',
      status,
      message,
      details: {
        total: totalCount,
        enabled: enabledCount,
        executeMode: executeModeCount,
        dryRunMode: enabledCount - executeModeCount,
      },
    }
  } catch (error) {
    return {
      name: 'Trigger Status',
      status: 'warn',
      message: `Could not check trigger status: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function checkBundleExecutor(): Promise<DoctorCheck> {
  const flags = getExtendedFeatureFlagSummary()
  const executorEnabled = flags.bundle_executor_enabled
  const triggersEnabled = flags.bundle_triggers_enabled

  const details = {
    bundleExecutorEnabled: executorEnabled,
    bundleTriggersEnabled: triggersEnabled,
  }

  if (!executorEnabled && !triggersEnabled) {
    return {
      name: 'Bundle Executor Readiness',
      status: 'pass',
      message: 'Bundle executor disabled (feature flags OFF)',
      details,
    }
  }

  if (executorEnabled && !triggersEnabled) {
    return {
      name: 'Bundle Executor Readiness',
      status: 'warn',
      message: 'Bundle executor enabled but triggers disabled - no auto-execution',
      details,
      fixSteps: [
        'Enable triggers if auto-execution desired:',
        '  - JOBFORGE_BUNDLE_TRIGGERS_ENABLED=1',
      ],
    }
  }

  return {
    name: 'Bundle Executor Readiness',
    status: 'pass',
    message: 'Bundle executor and triggers both enabled',
    details,
  }
}

async function checkReplayReadiness(): Promise<DoctorCheck> {
  const flags = getExtendedFeatureFlagSummary()
  const replayEnabled = flags.replay_pack_enabled

  if (!replayEnabled) {
    return {
      name: 'Replay Bundle Readiness',
      status: 'pass',
      message: 'Replay packs disabled (REPLAY_PACK_ENABLED=0)',
      details: { replayPackEnabled: false },
    }
  }

  // Check for artifacts directory
  try {
    await access('.jobforge/artifacts')
    return {
      name: 'Replay Bundle Readiness',
      status: 'pass',
      message: 'Replay packs enabled and artifacts directory exists',
      details: { replayPackEnabled: true, artifactsDir: '.jobforge/artifacts' },
    }
  } catch {
    return {
      name: 'Replay Bundle Readiness',
      status: 'warn',
      message: 'Replay packs enabled but artifacts directory not found',
      details: { replayPackEnabled: true },
      fixSteps: ['Create artifacts directory:', '  - mkdir -p .jobforge/artifacts'],
    }
  }
}

async function checkDiskSpace(): Promise<DoctorCheck> {
  try {
    // Simple check - just see if we can write to current directory
    const testFile = `.doctor-test-${Date.now()}`
    const fs = await import('fs/promises')
    await fs.writeFile(testFile, 'test')
    await fs.unlink(testFile)

    return {
      name: 'Disk Space',
      status: 'pass',
      message: 'Writeable space available in working directory',
    }
  } catch (error) {
    return {
      name: 'Disk Space',
      status: 'fail',
      message: `Cannot write to working directory: ${error instanceof Error ? error.message : String(error)}`,
      fixSteps: [
        'Check disk space: df -h',
        'Check permissions: ls -la',
        'Clean up disk space if full',
      ],
    }
  }
}

function checkUnsafeFlagsInProd(): DoctorCheck {
  const isProd = process.env.NODE_ENV === 'production'
  if (!isProd) {
    return {
      name: 'Production Safety Check',
      status: 'pass',
      message: 'Not in production mode - skipping unsafe flag check',
      details: { nodeEnv: process.env.NODE_ENV || 'not set' },
    }
  }

  const flags = getExtendedFeatureFlagSummary()
  const unsafeFlags: string[] = []

  // Check for potentially unsafe flags in production
  if (flags.action_jobs_enabled) unsafeFlags.push('JOBFORGE_ACTION_JOBS_ENABLED')
  if (flags.bundle_executor_enabled && !flags.require_policy_tokens) {
    unsafeFlags.push('JOBFORGE_BUNDLE_EXECUTOR_ENABLED without JOBFORGE_REQUIRE_POLICY_TOKENS')
  }

  if (unsafeFlags.length === 0) {
    return {
      name: 'Production Safety Check',
      status: 'pass',
      message: 'No unsafe flags detected in production',
      details: { environment: 'production' },
    }
  }

  return {
    name: 'Production Safety Check',
    status: 'fail',
    message: `⚠️  UNSAFE FLAGS ENABLED IN PRODUCTION: ${unsafeFlags.join(', ')}`,
    details: {
      environment: 'production',
      unsafeFlags,
      actionJobsEnabled: flags.action_jobs_enabled,
      policyTokensRequired: flags.require_policy_tokens,
      policyTokenSecretSet: flags.policy_token_secret_set,
    },
    fixSteps: [
      '⚠️  WARNING: Action jobs are enabled in production without proper safeguards!',
      '',
      'Immediate actions required:',
      '  1. Disable action jobs: JOBFORGE_ACTION_JOBS_ENABLED=0',
      '  2. Enable policy token requirement: JOBFORGE_REQUIRE_POLICY_TOKENS=1',
      '  3. Set a strong policy token secret: JOBFORGE_POLICY_TOKEN_SECRET=<strong-secret>',
      '',
      'Or if this is intentional:',
      '  - Document the exception in your security runbook',
      '  - Ensure all action jobs have explicit approval workflows',
    ],
  }
}

// ============================================================================
// Main Doctor Function
// ============================================================================

export async function runDoctor(): Promise<DoctorReport> {
  // Check if doctor is enabled
  const enabledCheck = checkDoctorEnabled()
  if (!enabledCheck.canRun) {
    return {
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      overallStatus: 'critical',
      checks: [
        {
          name: 'Doctor Enabled',
          status: 'fail',
          message: enabledCheck.reason || 'Doctor is disabled',
          fixSteps: ['Set JOBFORGE_DOCTOR_ENABLED=1 to enable doctor'],
        },
      ],
      summary: { passed: 0, warnings: 0, failed: 1, skipped: 0 },
      unsafeFlagsInProd: [],
      fixSteps: ['Set JOBFORGE_DOCTOR_ENABLED=1'],
    }
  }

  // Run all checks
  const checks = await Promise.all([
    checkNodeVersion(),
    checkPnpmVersion(),
    checkLockfile(),
    checkEnvVars(),
    checkDbConnectivity(),
    checkMigrations(),
    checkTriggerStatus(),
    checkBundleExecutor(),
    checkReplayReadiness(),
    checkDiskSpace(),
    checkUnsafeFlagsInProd(),
  ])

  // Calculate summary
  const summary = {
    passed: checks.filter((c) => c.status === 'pass').length,
    warnings: checks.filter((c) => c.status === 'warn').length,
    failed: checks.filter((c) => c.status === 'fail').length,
    skipped: checks.filter((c) => c.status === 'skip').length,
  }

  // Determine overall status
  let overallStatus: DoctorReport['overallStatus'] = 'healthy'
  if (summary.failed > 0) {
    overallStatus = 'critical'
  } else if (summary.warnings > 0) {
    overallStatus = 'degraded'
  }

  // Collect unsafe flags
  const unsafeFlagsInProd: string[] = []
  const safetyCheck = checks.find((c) => c.name === 'Production Safety Check')
  if (safetyCheck?.details?.unsafeFlags) {
    unsafeFlagsInProd.push(...(safetyCheck.details.unsafeFlags as string[]))
  }

  // Collect all fix steps
  const fixSteps = checks.flatMap((c) => c.fixSteps || [])

  return {
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    overallStatus,
    checks,
    summary,
    unsafeFlagsInProd,
    fixSteps,
  }
}

// ============================================================================
// Formatters
// ============================================================================

export function formatDoctorReportHuman(report: DoctorReport): string {
  const lines: string[] = []

  // Header
  lines.push('='.repeat(60))
  lines.push('JobForge System Doctor Report')
  lines.push('='.repeat(60))
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Overall Status: ${report.overallStatus.toUpperCase()}`)
  lines.push('')

  // Summary
  lines.push('Summary:')
  lines.push(`  ✓ Passed:   ${report.summary.passed}`)
  lines.push(`  ⚠ Warnings: ${report.summary.warnings}`)
  lines.push(`  ✗ Failed:   ${report.summary.failed}`)
  lines.push(`  ⊘ Skipped:  ${report.summary.skipped}`)
  lines.push('')

  // Checks
  lines.push('Checks:')
  lines.push('-'.repeat(60))

  for (const check of report.checks) {
    const icon =
      check.status === 'pass'
        ? '✓'
        : check.status === 'warn'
          ? '⚠'
          : check.status === 'fail'
            ? '✗'
            : '⊘'
    lines.push(`${icon} ${check.name}: ${check.message}`)

    if (check.details && Object.keys(check.details).length > 0) {
      for (const [key, value] of Object.entries(check.details)) {
        if (typeof value === 'object') {
          lines.push(`    ${key}: ${JSON.stringify(value)}`)
        } else {
          lines.push(`    ${key}: ${value}`)
        }
      }
    }
  }

  lines.push('')

  // Unsafe flags warning
  if (report.unsafeFlagsInProd.length > 0) {
    lines.push('⚠️  UNSAFE FLAGS IN PRODUCTION ⚠️')
    lines.push('='.repeat(60))
    for (const flag of report.unsafeFlagsInProd) {
      lines.push(`  - ${flag}`)
    }
    lines.push('')
  }

  // Fix steps
  if (report.fixSteps.length > 0) {
    lines.push('Suggested Fix Steps:')
    lines.push('-'.repeat(60))
    for (const step of report.fixSteps) {
      lines.push(step)
    }
    lines.push('')
  }

  // Footer
  lines.push('='.repeat(60))
  lines.push('Run with --json for machine-readable output')
  lines.push('Run with --apply to attempt auto-fixes (requires confirmation)')
  lines.push('='.repeat(60))

  return lines.join('\n')
}

export function formatDoctorReportJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2)
}
