#!/usr/bin/env tsx
/**
 * JobForge Daily Run CLI
 *
 * The "solo founder daily" - runs the operator loop with safe defaults
 *
 * Commands:
 *   daily          - Run the daily operator loop
 *   daily --dry    - Dry run (no side effects)
 *
 * What it does:
 *   1. Runs doctor
 *   2. Lists last 24h bundle runs by tenant/project
 *   3. Highlights failures/anomalies
 *   4. Exports daily summary report artifact
 *   5. Provides recommended bundle executions (dry-run only)
 *
 * Safety:
 *   - No external network assumptions
 *   - No auto-actions
 *   - Uses existing primitives only
 *   - Feature flag: JOBFORGE_DAILY_RUN_ENABLED=1
 *
 * Usage:
 *   pnpm jobforge:daily
 *   pnpm jobforge:daily --dry
 *   JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily
 */

import {
  runDoctor,
  formatDoctorReportHuman,
  type DoctorReport,
} from '../packages/shared/src/doctor.js'
import { JOBFORGE_DAILY_RUN_ENABLED } from '../packages/shared/src/feature-flags.js'
import { mkdir, writeFile, access, readdir, readFile } from 'fs/promises'
import { join } from 'path'

// ============================================================================
// Types
// ============================================================================

interface DailyRunOptions {
  dry: boolean
  outputDir: string
  tenantId?: string
}

interface DailySummary {
  timestamp: string
  date: string
  tenantId?: string
  doctorReport: DoctorReport | null
  bundleRuns: BundleRunInfo[]
  anomalies: Anomaly[]
  recommendations: Recommendation[]
  stats: DailyStats
}

interface BundleRunInfo {
  runId: string
  tenantId: string
  projectId?: string
  jobType: string
  status: 'success' | 'failed' | 'running' | 'unknown'
  startedAt: string
  completedAt?: string
  durationMs?: number
  artifactCount: number
  hasReplay: boolean
}

interface Anomaly {
  type: 'failure' | 'timeout' | 'high_latency' | 'no_artifacts' | 'replay_missing'
  runId: string
  severity: 'warning' | 'critical'
  message: string
  details?: Record<string, unknown>
}

interface Recommendation {
  type: 'retry' | 'investigate' | 'review' | 'cleanup'
  runId: string
  priority: 'high' | 'medium' | 'low'
  message: string
  dryRunCommand: string
}

interface DailyStats {
  totalRuns: number
  successfulRuns: number
  failedRuns: number
  runningRuns: number
  totalArtifacts: number
  averageDurationMs: number
  byTenant: Record<string, number>
  byJobType: Record<string, number>
}

// ============================================================================
// Implementation
// ============================================================================

async function runDaily(options: DailyRunOptions): Promise<DailySummary> {
  console.log('JobForge Daily Run')
  console.log('='.repeat(60))
  console.log(`Date: ${new Date().toISOString().split('T')[0]}`)
  console.log(`Mode: ${options.dry ? 'DRY RUN' : 'NORMAL'}`)
  console.log('')

  const summary: DailySummary = {
    timestamp: new Date().toISOString(),
    date: new Date().toISOString().split('T')[0],
    tenantId: options.tenantId,
    doctorReport: null,
    bundleRuns: [],
    anomalies: [],
    recommendations: [],
    stats: {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      runningRuns: 0,
      totalArtifacts: 0,
      averageDurationMs: 0,
      byTenant: {},
      byJobType: {},
    },
  }

  // Step 1: Run doctor
  console.log('Step 1: Running system doctor...')
  try {
    summary.doctorReport = await runDoctor()
    console.log(`  Status: ${summary.doctorReport.overallStatus}`)
    console.log(
      `  Checks: ${summary.doctorReport.summary.passed} passed, ${summary.doctorReport.summary.failed} failed`
    )

    if (summary.doctorReport.overallStatus === 'critical') {
      console.log('  ⚠️  Critical issues detected!')
    }
  } catch (error) {
    console.log(`  ⚠️  Doctor failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  console.log('')

  // Step 2: Scan for bundle runs
  console.log('Step 2: Scanning for bundle runs...')
  const runs = await scanBundleRuns(options)
  summary.bundleRuns = runs
  console.log(`  Found ${runs.length} runs in last 24h`)
  console.log('')

  // Step 3: Calculate stats
  summary.stats = calculateStats(runs)
  console.log('Step 3: Statistics')
  console.log(`  Total runs: ${summary.stats.totalRuns}`)
  console.log(`  Successful: ${summary.stats.successfulRuns}`)
  console.log(`  Failed: ${summary.stats.failedRuns}`)
  console.log(`  Running: ${summary.stats.runningRuns}`)
  console.log('')

  // Step 4: Detect anomalies
  console.log('Step 4: Detecting anomalies...')
  summary.anomalies = detectAnomalies(runs)
  if (summary.anomalies.length === 0) {
    console.log('  ✓ No anomalies detected')
  } else {
    console.log(`  ⚠️  ${summary.anomalies.length} anomalies detected`)
    for (const anomaly of summary.anomalies.slice(0, 5)) {
      console.log(`    - ${anomaly.type}: ${anomaly.message}`)
    }
    if (summary.anomalies.length > 5) {
      console.log(`    ... and ${summary.anomalies.length - 5} more`)
    }
  }
  console.log('')

  // Step 5: Generate recommendations
  console.log('Step 5: Generating recommendations...')
  summary.recommendations = generateRecommendations(runs, summary.anomalies)
  if (summary.recommendations.length === 0) {
    console.log('  ✓ No actions needed')
  } else {
    console.log(`  → ${summary.recommendations.length} recommendations`)
    for (const rec of summary.recommendations.slice(0, 5)) {
      console.log(`    [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.message}`)
    }
    if (summary.recommendations.length > 5) {
      console.log(`    ... and ${summary.recommendations.length - 5} more`)
    }
  }
  console.log('')

  // Step 6: Export summary
  console.log('Step 6: Exporting summary...')
  const outputPath = await exportDailySummary(summary, options.outputDir)
  console.log(`  ✓ Exported to ${outputPath}`)
  console.log('')

  // Final summary
  console.log('='.repeat(60))
  console.log('Daily Run Complete')
  console.log('='.repeat(60))
  console.log(`Output: ${outputPath}`)
  console.log('')

  if (!options.dry && summary.recommendations.length > 0) {
    console.log('Recommended next steps (DRY-RUN only):')
    for (const rec of summary.recommendations.slice(0, 3)) {
      console.log(`  ${rec.dryRunCommand}`)
    }
  }

  return summary
}

async function scanBundleRuns(options: DailyRunOptions): Promise<BundleRunInfo[]> {
  const runs: BundleRunInfo[] = []
  const artifactsDir = '.jobforge/artifacts'
  const cutoffTime = Date.now() - 24 * 60 * 60 * 1000 // 24 hours ago

  try {
    // Try to read artifacts directory
    const files = await readdir(artifactsDir).catch(() => [])

    for (const file of files) {
      if (!file.endsWith('.json') || file.includes('manifest')) {
        continue
      }

      try {
        const filepath = join(artifactsDir, file)
        const content = await readFile(filepath, 'utf-8')
        const artifact = JSON.parse(content)

        // Check if artifact is from last 24h
        const timestamp =
          artifact.timestamp || artifact.createdAt || artifact.provenance?.provenance?.createdAt
        if (!timestamp) continue

        const artifactTime = new Date(timestamp).getTime()
        if (artifactTime < cutoffTime) continue

        // Extract run info
        const runId = artifact.runId || artifact.provenance?.runId || file.replace('.json', '')
        const tenantId = artifact.tenantId || artifact.provenance?.tenantId || 'unknown'
        const projectId = artifact.projectId || artifact.provenance?.projectId
        const jobType = artifact.jobType || artifact.provenance?.jobType || 'unknown'

        // Determine status
        let status: BundleRunInfo['status'] = 'unknown'
        if (artifact.status === 'succeeded' || artifact.provenance?.success) {
          status = 'success'
        } else if (artifact.status === 'failed') {
          status = 'failed'
        } else if (artifact.status === 'running') {
          status = 'running'
        }

        // Filter by tenant if specified
        if (options.tenantId && tenantId !== options.tenantId) {
          continue
        }

        runs.push({
          runId,
          tenantId,
          projectId,
          jobType,
          status,
          startedAt: timestamp,
          completedAt: artifact.completedAt,
          durationMs: artifact.durationMs,
          artifactCount: 1,
          hasReplay: file.includes('replay') || file.includes('verify-pack'),
        })
      } catch {
        // Skip invalid artifacts
        continue
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }

  // Sort by timestamp (newest first)
  return runs.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
}

function calculateStats(runs: BundleRunInfo[]): DailyStats {
  const stats: DailyStats = {
    totalRuns: runs.length,
    successfulRuns: runs.filter((r) => r.status === 'success').length,
    failedRuns: runs.filter((r) => r.status === 'failed').length,
    runningRuns: runs.filter((r) => r.status === 'running').length,
    totalArtifacts: runs.reduce((sum, r) => sum + r.artifactCount, 0),
    averageDurationMs: 0,
    byTenant: {},
    byJobType: {},
  }

  // Calculate average duration
  const durations = runs.filter((r) => r.durationMs).map((r) => r.durationMs!)
  if (durations.length > 0) {
    stats.averageDurationMs = Math.round(
      durations.reduce((sum, d) => sum + d, 0) / durations.length
    )
  }

  // Group by tenant
  for (const run of runs) {
    stats.byTenant[run.tenantId] = (stats.byTenant[run.tenantId] || 0) + 1
    stats.byJobType[run.jobType] = (stats.byJobType[run.jobType] || 0) + 1
  }

  return stats
}

function detectAnomalies(runs: BundleRunInfo[]): Anomaly[] {
  const anomalies: Anomaly[] = []

  for (const run of runs) {
    // Failed runs
    if (run.status === 'failed') {
      anomalies.push({
        type: 'failure',
        runId: run.runId,
        severity: 'critical',
        message: `Run ${run.runId.slice(0, 8)}... failed`,
      })
    }

    // Long running
    if (run.status === 'running') {
      const startTime = new Date(run.startedAt).getTime()
      const duration = Date.now() - startTime
      if (duration > 60 * 60 * 1000) {
        // Running for > 1 hour
        anomalies.push({
          type: 'timeout',
          runId: run.runId,
          severity: 'warning',
          message: `Run ${run.runId.slice(0, 8)}... has been running for ${Math.round(duration / 60000)} minutes`,
        })
      }
    }

    // High latency
    if (run.durationMs && run.durationMs > 5 * 60 * 1000) {
      // Took > 5 minutes
      anomalies.push({
        type: 'high_latency',
        runId: run.runId,
        severity: 'warning',
        message: `Run ${run.runId.slice(0, 8)}... took ${Math.round(run.durationMs / 1000)}s`,
      })
    }

    // No replay for important runs
    if (run.jobType.includes('verify') && !run.hasReplay) {
      anomalies.push({
        type: 'replay_missing',
        runId: run.runId,
        severity: 'warning',
        message: `Verify run ${run.runId.slice(0, 8)}... missing replay bundle`,
      })
    }
  }

  return anomalies
}

function generateRecommendations(runs: BundleRunInfo[], anomalies: Anomaly[]): Recommendation[] {
  const recommendations: Recommendation[] = []

  for (const anomaly of anomalies) {
    switch (anomaly.type) {
      case 'failure':
        recommendations.push({
          type: 'retry',
          runId: anomaly.runId,
          priority: 'high',
          message: `Retry failed run ${anomaly.runId.slice(0, 8)}...`,
          dryRunCommand: `pnpm jobforge:retry --run ${anomaly.runId} --dry-run`,
        })
        break
      case 'timeout':
        recommendations.push({
          type: 'investigate',
          runId: anomaly.runId,
          priority: 'high',
          message: `Investigate long-running run ${anomaly.runId.slice(0, 8)}...`,
          dryRunCommand: `pnpm jobforge:status --run ${anomaly.runId}`,
        })
        break
      case 'replay_missing':
        recommendations.push({
          type: 'review',
          runId: anomaly.runId,
          priority: 'medium',
          message: `Review replay configuration for ${anomaly.runId.slice(0, 8)}...`,
          dryRunCommand: `# Enable REPLAY_PACK_ENABLED for future runs`,
        })
        break
    }
  }

  // Add cleanup recommendation if many artifacts
  const totalArtifacts = runs.reduce((sum, r) => sum + r.artifactCount, 0)
  if (totalArtifacts > 100) {
    recommendations.push({
      type: 'cleanup',
      runId: 'system',
      priority: 'low',
      message: `Consider cleaning up ${totalArtifacts} artifacts`,
      dryRunCommand: `pnpm jobforge:cleanup --dry-run --older-than 7d`,
    })
  }

  // Sort by priority
  const priorityOrder = { high: 0, medium: 1, low: 2 }
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
}

async function exportDailySummary(summary: DailySummary, outputDir: string): Promise<string> {
  await mkdir(outputDir, { recursive: true })

  const filename = `daily-summary-${summary.date}.json`
  const filepath = join(outputDir, filename)

  // Export JSON
  await writeFile(filepath, JSON.stringify(summary, null, 2))

  // Export markdown report
  const markdown = formatDailySummaryMarkdown(summary)
  const mdFilename = `daily-summary-${summary.date}.md`
  const mdFilepath = join(outputDir, mdFilename)
  await writeFile(mdFilepath, markdown)

  return filepath
}

function formatDailySummaryMarkdown(summary: DailySummary): string {
  const lines: string[] = []

  lines.push(`# JobForge Daily Summary`)
  lines.push('')
  lines.push(`**Date**: ${summary.date}`)
  lines.push(`**Generated**: ${summary.timestamp}`)
  if (summary.tenantId) {
    lines.push(`**Tenant**: ${summary.tenantId}`)
  }
  lines.push('')

  // Doctor status
  lines.push('## System Health')
  if (summary.doctorReport) {
    lines.push(`**Status**: ${summary.doctorReport.overallStatus}`)
    lines.push(
      `**Checks**: ${summary.doctorReport.summary.passed} passed, ${summary.doctorReport.summary.warnings} warnings, ${summary.doctorReport.summary.failed} failed`
    )

    if (summary.doctorReport.unsafeFlagsInProd.length > 0) {
      lines.push('')
      lines.push('⚠️ **Unsafe Flags in Production** ⚠️')
      for (const flag of summary.doctorReport.unsafeFlagsInProd) {
        lines.push(`- ${flag}`)
      }
    }
  } else {
    lines.push('*Doctor report unavailable*')
  }
  lines.push('')

  // Stats
  lines.push('## Statistics')
  lines.push(`- Total runs: ${summary.stats.totalRuns}`)
  lines.push(`- Successful: ${summary.stats.successfulRuns}`)
  lines.push(`- Failed: ${summary.stats.failedRuns}`)
  lines.push(`- Running: ${summary.stats.runningRuns}`)
  lines.push(`- Total artifacts: ${summary.stats.totalArtifacts}`)
  if (summary.stats.averageDurationMs > 0) {
    lines.push(`- Average duration: ${Math.round(summary.stats.averageDurationMs / 1000)}s`)
  }
  lines.push('')

  // By tenant
  if (Object.keys(summary.stats.byTenant).length > 0) {
    lines.push('### By Tenant')
    for (const [tenant, count] of Object.entries(summary.stats.byTenant)) {
      lines.push(`- ${tenant}: ${count} runs`)
    }
    lines.push('')
  }

  // By job type
  if (Object.keys(summary.stats.byJobType).length > 0) {
    lines.push('### By Job Type')
    for (const [jobType, count] of Object.entries(summary.stats.byJobType)) {
      lines.push(`- ${jobType}: ${count} runs`)
    }
    lines.push('')
  }

  // Anomalies
  lines.push('## Anomalies')
  if (summary.anomalies.length === 0) {
    lines.push('*No anomalies detected*')
  } else {
    for (const anomaly of summary.anomalies) {
      const icon = anomaly.severity === 'critical' ? '🔴' : '🟡'
      lines.push(`${icon} **${anomaly.type}**: ${anomaly.message}`)
    }
  }
  lines.push('')

  // Recommendations
  lines.push('## Recommendations')
  if (summary.recommendations.length === 0) {
    lines.push('*No actions needed*')
  } else {
    for (const rec of summary.recommendations) {
      const icon = rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🔵'
      lines.push(`${icon} [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.message}`)
      lines.push(`   \`${rec.dryRunCommand}\``)
      lines.push('')
    }
  }

  // Recent runs
  lines.push('## Recent Runs')
  const recentRuns = summary.bundleRuns.slice(0, 10)
  if (recentRuns.length === 0) {
    lines.push('*No runs in last 24h*')
  } else {
    for (const run of recentRuns) {
      const icon = run.status === 'success' ? '✓' : run.status === 'failed' ? '✗' : '⏳'
      lines.push(`- ${icon} **${run.jobType}** (${run.runId.slice(0, 8)}...) - ${run.status}`)
    }
    if (summary.bundleRuns.length > 10) {
      lines.push(`- ... and ${summary.bundleRuns.length - 10} more`)
    }
  }
  lines.push('')

  lines.push('---')
  lines.push('*Generated by JobForge Daily Run*')

  return lines.join('\n')
}

// ============================================================================
// CLI
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
JobForge Daily Run CLI

The "solo founder daily" - runs the operator loop with safe defaults

Usage:
  pnpm jobforge:daily [options]

Options:
  --dry            Dry run (no side effects, read-only)
  --tenant <id>    Filter by tenant ID
  --output <dir>   Output directory for reports (default: .jobforge/daily)
  --help           Show this help

Environment:
  JOBFORGE_DAILY_RUN_ENABLED=1  Required to run
  JOBFORGE_DOCTOR_ENABLED=1     Recommended for health checks

What it does:
  1. Runs system doctor
  2. Scans for bundle runs in last 24h
  3. Detects anomalies and failures
  4. Generates recommendations
  5. Exports JSON and Markdown reports

Safety:
  - Never auto-executes actions
  - All recommendations are dry-run commands
  - Requires explicit feature flag
  - No external network calls

Examples:
  # Run daily check
  JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily

  # Dry run (read-only)
  JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --dry

  # Filter by tenant
  JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily --tenant tenant-123
`)
    process.exit(0)
  }

  // Check if enabled
  if (!JOBFORGE_DAILY_RUN_ENABLED) {
    console.error('Error: JOBFORGE_DAILY_RUN_ENABLED is not set to 1')
    console.error('')
    console.error('The daily run is disabled by default. To enable:')
    console.error('  export JOBFORGE_DAILY_RUN_ENABLED=1')
    console.error('')
    console.error('Or run with:')
    console.error('  JOBFORGE_DAILY_RUN_ENABLED=1 pnpm jobforge:daily')
    process.exit(1)
  }

  const options: DailyRunOptions = {
    dry: args.includes('--dry'),
    outputDir: '.jobforge/daily',
  }

  // Parse options
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--tenant' && args[i + 1]) {
      options.tenantId = args[++i]
    } else if (arg === '--output' && args[i + 1]) {
      options.outputDir = args[++i]
    }
  }

  try {
    await runDaily(options)
    process.exit(0)
  } catch (error) {
    console.error(`Daily run failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()
