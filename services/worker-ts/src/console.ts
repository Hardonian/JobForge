#!/usr/bin/env node
/**
 * JobForge Ops Console CLI
 * Operator-friendly console for inspecting bundle trees, triggers, and manifests
 */

import * as fs from 'fs'
import type { EventEnvelope } from '@jobforge/shared'

// ============================================================================
// Types
// ============================================================================

interface ConsoleConfig {
  supabaseUrl: string
  supabaseKey: string
  tenantId: string
  projectId?: string
}

interface RedactedOutput {
  [key: string]: unknown
}

const EXIT_CODES = {
  success: 0,
  validation: 2,
  failure: 1,
}

const DEBUG_ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

let sharedModule: typeof import('@jobforge/shared') | null = null
let sdkModule: typeof import('@jobforge/sdk-ts') | null = null

async function loadSharedModule(): Promise<typeof import('@jobforge/shared')> {
  if (!sharedModule) {
    sharedModule = await import('@jobforge/shared')
  }
  return sharedModule
}

async function loadSdkModule(): Promise<typeof import('@jobforge/sdk-ts')> {
  if (!sdkModule) {
    sdkModule = await import('@jobforge/sdk-ts')
  }
  return sdkModule
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function logUnexpectedError(message: string, error: unknown): void {
  printError(message, formatError(error))
  if (DEBUG_ENABLED && error instanceof Error && error.stack) {
    console.error(error.stack)
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function redactSecrets(obj: Record<string, unknown>): RedactedOutput {
  const redacted: RedactedOutput = {}
  const secretKeys = ['token', 'password', 'secret', 'key', 'credential', 'auth']

  for (const [key, value] of Object.entries(obj)) {
    const isSecret = secretKeys.some((sk) => key.toLowerCase().includes(sk))
    if (isSecret && typeof value === 'string') {
      redacted[key] = value.length > 8 ? `${value.slice(0, 4)}****${value.slice(-4)}` : '****'
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSecrets(value as Record<string, unknown>)
    } else {
      redacted[key] = value
    }
  }

  return redacted
}

function formatDate(isoString: string | null): string {
  if (!isoString) return 'never'
  const date = new Date(isoString)
  return date.toLocaleString()
}

function _formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function printHeader(title: string): void {
  console.log(`
${'='.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'='.repeat(60)}`)
}

function printFooter(): void {
  console.log(`${'='.repeat(60)}\n`)
}

function printError(message: string, details?: string): void {
  console.error(`\n❌ ERROR: ${message}`)
  if (details) {
    console.error(`   ${details}`)
  }
}

function printSuccess(message: string): void {
  console.log(`\n✅ ${message}`)
}

function _printWarning(message: string): void {
  console.log(`\n⚠️  ${message}`)
}

function printInfo(message: string): void {
  console.log(`ℹ️  ${message}`)
}

// ============================================================================
// Command Handlers
// ============================================================================

async function listBundles(config: ConsoleConfig, args: string[]): Promise<void> {
  const sinceArg = args.find((a) => a.startsWith('--since='))
  const since = sinceArg ? sinceArg.split('=')[1] : undefined
  const jsonOutput = args.includes('--json')

  printHeader('Bundle Runs List')
  console.log(`Tenant: ${config.tenantId}`)
  if (config.projectId) console.log(`Project: ${config.projectId}`)
  if (since) console.log(`Since: ${since}`)

  try {
    const { JobForgeClient } = await loadSdkModule()

    // Use client to query bundle runs
    const client = new JobForgeClient({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    })

    // Query for bundle executor jobs
    const jobs = await client.listJobs({
      tenant_id: config.tenantId,
      filters: {
        type: 'jobforge.autopilot.execute_request_bundle',
        limit: 50,
      },
    })

    if (jobs.length === 0) {
      printInfo('No bundle runs found')
      printFooter()
      return
    }

    if (jsonOutput) {
      console.log(JSON.stringify(redactSecrets({ bundles: jobs }), null, 2))
    } else {
      console.log(`\nFound ${jobs.length} bundle runs:\n`)
      console.log(
        `${'Bundle Run ID'.padEnd(40)} ${'Status'.padEnd(12)} ${'Created'.padEnd(25)} ${'Mode'.padEnd(10)}`
      )
      console.log('-'.repeat(90))

      for (const job of jobs) {
        const payload = job.payload as Record<string, string> | undefined
        const id = job.id.slice(0, 38).padEnd(40)
        const status = job.status.padEnd(12)
        const created = formatDate(job.created_at).padEnd(25)
        const mode = (payload?.mode || 'unknown').padEnd(10)
        console.log(`${id} ${status} ${created} ${mode}`)
      }
    }

    printFooter()
  } catch (error) {
    logUnexpectedError('Failed to list bundles', error)
    process.exit(EXIT_CODES.failure)
  }
}

async function showBundle(config: ConsoleConfig, args: string[]): Promise<void> {
  const runArg = args.find((a) => a.startsWith('--run='))
  const runId = runArg ? runArg.split('=')[1] : undefined
  const jsonOutput = args.includes('--json')

  if (!runId) {
    printError('Missing required argument: --run=<bundle_run_id>')
    console.log('\nUsage: jobforge console bundles:show --run=<id> [--json]')
    process.exit(EXIT_CODES.validation)
  }

  printHeader(`Bundle Run: ${runId.slice(0, 16)}...`)

  try {
    const { JobForgeClient } = await loadSdkModule()

    const client = new JobForgeClient({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    })

    const job = await client.getJob(runId, config.tenantId)

    if (!job) {
      printError('Bundle run not found')
      process.exit(EXIT_CODES.validation)
    }

    const result = job.result_id ? await client.getResult(job.result_id, config.tenantId) : null

    interface ChildRun {
      request_id?: string
      job_type?: string
      status?: string
    }

    interface SummaryData {
      [key: string]: string | number | boolean | undefined
    }

    const bundleData: {
      run_id: string
      tenant_id: string
      project_id: unknown
      status: string
      created_at: string
      finished_at: string | null
      mode: unknown
      trace_id: unknown
      attempts: number
      child_runs: ChildRun[]
      summary: SummaryData
      manifest_ref: string | null | undefined
    } = {
      run_id: job.id,
      tenant_id: job.tenant_id,
      project_id: job.payload?.project_id,
      status: job.status,
      created_at: job.created_at,
      finished_at: job.finished_at,
      mode: (job.payload as Record<string, unknown> | undefined)?.mode,
      trace_id: (job.payload as Record<string, unknown> | undefined)?.trace_id,
      attempts: job.attempts,
      child_runs: (result?.result?.child_runs as ChildRun[]) || [],
      summary: (result?.result?.summary as SummaryData) || {},
      manifest_ref: result?.artifact_ref,
    }

    if (jsonOutput) {
      console.log(JSON.stringify(redactSecrets(bundleData), null, 2))
    } else {
      console.log(`\nStatus: ${bundleData.status.toUpperCase()}`)
      console.log(`Mode: ${bundleData.mode || 'unknown'}`)
      console.log(`Created: ${formatDate(bundleData.created_at)}`)
      if (bundleData.finished_at) {
        console.log(`Finished: ${formatDate(bundleData.finished_at)}`)
      }
      console.log(`Attempts: ${bundleData.attempts}`)

      if (bundleData.summary && Object.keys(bundleData.summary).length > 0) {
        console.log(`\nSummary:`)
        for (const [key, value] of Object.entries(bundleData.summary)) {
          console.log(`  ${key}: ${value}`)
        }
      }

      if (bundleData.child_runs.length > 0) {
        console.log(`\nChild Runs (${bundleData.child_runs.length}):`)
        console.log(`${'Request ID'.padEnd(30)} ${'Job Type'.padEnd(35)} ${'Status'.padEnd(12)}`)
        console.log('-'.repeat(80))
        for (const child of bundleData.child_runs) {
          const reqId = (child.request_id || 'N/A').slice(0, 28).padEnd(30)
          const jobType = (child.job_type || 'N/A').slice(0, 33).padEnd(35)
          const status = (child.status || 'N/A').padEnd(12)
          console.log(`${reqId} ${jobType} ${status}`)
        }
      }

      if (bundleData.manifest_ref) {
        console.log(`\nManifest: ${bundleData.manifest_ref}`)
      }
    }

    printFooter()
  } catch (error) {
    logUnexpectedError('Failed to show bundle', error)
    process.exit(EXIT_CODES.failure)
  }
}

async function listTriggers(config: ConsoleConfig, args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json')
  const projectFilter = config.projectId

  printHeader('Bundle Trigger Rules')
  console.log(`Tenant: ${config.tenantId}`)
  if (projectFilter) console.log(`Project: ${projectFilter}`)

  try {
    const { listTriggerRules } = await loadSharedModule()

    // Use in-memory storage for now (production would use DB)
    const rules = listTriggerRules(config.tenantId, projectFilter)

    if (rules.length === 0) {
      printInfo('No trigger rules found')
      printFooter()
      return
    }

    if (jsonOutput) {
      console.log(JSON.stringify(redactSecrets({ rules }), null, 2))
    } else {
      console.log(`\nFound ${rules.length} trigger rules:\n`)
      console.log(
        `${'Rule ID'.padEnd(40)} ${'Name'.padEnd(25)} ${'Enabled'.padEnd(10)} ${'Mode'.padEnd(10)} ${'Fired'.padEnd(8)}`
      )
      console.log('-'.repeat(100))

      for (const rule of rules) {
        const id = rule.rule_id.slice(0, 38).padEnd(40)
        const name = rule.name.slice(0, 23).padEnd(25)
        const enabled = (rule.enabled ? '✓' : '✗').padEnd(10)
        const mode = rule.action.mode.padEnd(10)
        const fired = String(rule.fire_count).padEnd(8)
        console.log(`${id} ${name} ${enabled} ${mode} ${fired}`)
      }
    }

    printFooter()
  } catch (error) {
    logUnexpectedError('Failed to list triggers', error)
    process.exit(EXIT_CODES.failure)
  }
}

async function showTrigger(config: ConsoleConfig, args: string[]): Promise<void> {
  const ruleArg = args.find((a) => a.startsWith('--rule='))
  const ruleId = ruleArg ? ruleArg.split('=')[1] : undefined
  const jsonOutput = args.includes('--json')

  if (!ruleId) {
    printError('Missing required argument: --rule=<rule_id>')
    console.log('\nUsage: jobforge console triggers:show --rule=<id> [--json]')
    process.exit(EXIT_CODES.validation)
  }

  printHeader(`Trigger Rule: ${ruleId.slice(0, 16)}...`)

  try {
    const { getTriggerRule } = await loadSharedModule()

    const rule = getTriggerRule(ruleId)

    if (!rule) {
      printError('Trigger rule not found')
      process.exit(EXIT_CODES.validation)
    }

    if (jsonOutput) {
      console.log(
        JSON.stringify(redactSecrets(rule as unknown as Record<string, unknown>), null, 2)
      )
    } else {
      console.log(`\nName: ${rule.name}`)
      console.log(`Tenant: ${rule.tenant_id}`)
      console.log(`Project: ${rule.project_id || '(none)'}`)
      console.log(`Enabled: ${rule.enabled ? '✓ Yes' : '✗ No'}`)
      console.log(`Fire Count: ${rule.fire_count}`)
      console.log(`Last Fired: ${formatDate(rule.last_fired_at)}`)

      console.log(`\nMatch Configuration:`)
      console.log(`  Event Types: ${rule.match.event_type_allowlist.join(', ')}`)
      if (rule.match.source_module_allowlist?.length) {
        console.log(`  Source Modules: ${rule.match.source_module_allowlist.join(', ')}`)
      }

      console.log(`\nAction Configuration:`)
      console.log(`  Bundle Source: ${rule.action.bundle_source}`)
      console.log(`  Mode: ${rule.action.mode}`)
      if (rule.action.bundle_ref) {
        console.log(`  Bundle Ref: ${rule.action.bundle_ref}`)
      }
      if (rule.action.bundle_builder) {
        console.log(`  Bundle Builder: ${rule.action.bundle_builder}`)
      }

      console.log(`\nSafety Configuration:`)
      console.log(`  Cooldown: ${rule.safety.cooldown_seconds}s`)
      console.log(`  Max Runs/Hour: ${rule.safety.max_runs_per_hour}`)
      console.log(`  Allow Action Jobs: ${rule.safety.allow_action_jobs ? 'Yes' : 'No'}`)
    }

    printFooter()
  } catch (error) {
    logUnexpectedError('Failed to show trigger', error)
    process.exit(EXIT_CODES.failure)
  }
}

async function dryRunTrigger(config: ConsoleConfig, args: string[]): Promise<void> {
  const ruleArg = args.find((a) => a.startsWith('--rule='))
  const eventArg = args.find((a) => a.startsWith('--event='))
  const ruleId = ruleArg ? ruleArg.split('=')[1] : undefined
  const eventPath = eventArg ? eventArg.split('=')[1] : undefined
  const jsonOutput = args.includes('--json')

  if (!ruleId || !eventPath) {
    printError('Missing required arguments', '--rule=<id> and --event=<path>')
    console.log('\nUsage: jobforge console triggers:dryrun --rule=<id> --event=<path> [--json]')
    process.exit(EXIT_CODES.validation)
  }

  printHeader('Trigger Dry Run')
  console.log(`Rule: ${ruleId}`)
  console.log(`Event File: ${eventPath}`)

  try {
    const { evaluateTriggers, getTriggerRule } = await loadSharedModule()

    // Load event from file
    if (!fs.existsSync(eventPath)) {
      printError('Event file not found', eventPath)
      process.exit(EXIT_CODES.validation)
    }

    const eventContent = fs.readFileSync(eventPath, 'utf-8')
    const event = JSON.parse(eventContent) as EventEnvelope

    // Validate event
    if (!event.tenant_id || !event.event_type || !event.trace_id) {
      printError('Invalid event format', 'Missing required fields: tenant_id, event_type, trace_id')
      process.exit(EXIT_CODES.validation)
    }

    // Get the rule
    const rule = getTriggerRule(ruleId)
    if (!rule) {
      printError('Trigger rule not found')
      process.exit(EXIT_CODES.validation)
    }

    // Run evaluation
    const report = evaluateTriggers(event, [rule], {
      bundleTriggersEnabled: true,
    })

    if (jsonOutput) {
      console.log(
        JSON.stringify(redactSecrets(report as unknown as Record<string, unknown>), null, 2)
      )
    } else {
      console.log(`\nEvent Type: ${event.event_type}`)
      console.log(`Event ID: ${event.trace_id}`)
      console.log(`\nEvaluation Results:`)

      for (const result of report.results) {
        const icon = result.decision === 'fire' ? '🔥' : result.matched ? '⏭️' : '⏹️'
        console.log(`\n${icon} Rule: ${result.rule_id.slice(0, 16)}...`)
        console.log(`   Decision: ${result.decision}`)
        console.log(`   Matched: ${result.matched ? 'Yes' : 'No'}`)
        console.log(`   Dry Run: ${result.dry_run ? 'Yes' : 'No'}`)
        console.log(`   Reason: ${result.reason}`)
        console.log(`   Safety Checks:`)
        console.log(`     - Cooldown: ${result.safety_checks.cooldown_passed ? '✓' : '✗'}`)
        console.log(`     - Rate Limit: ${result.safety_checks.rate_limit_passed ? '✓' : '✗'}`)
        console.log(`     - Dedupe: ${result.safety_checks.dedupe_passed ? '✓' : '✗'}`)
      }

      console.log(`\nSummary:`)
      console.log(`  Rules Evaluated: ${report.rules_evaluated}`)
      console.log(`  Rules Matched: ${report.rules_matched}`)
      console.log(`  Rules Fired: ${report.rules_fired}`)
    }

    printFooter()
  } catch (error) {
    if (error instanceof SyntaxError) {
      printError('Invalid JSON in event file', error.message)
      process.exit(EXIT_CODES.validation)
    } else {
      logUnexpectedError('Dry run failed', error)
      process.exit(EXIT_CODES.failure)
    }
  }
}

async function exportReplay(config: ConsoleConfig, args: string[]): Promise<void> {
  const runArg = args.find((a) => a.startsWith('--run='))
  const runId = runArg ? runArg.split('=')[1] : undefined
  const outputArg = args.find((a) => a.startsWith('--output='))
  const outputPath = outputArg ? outputArg.split('=')[1] : undefined

  if (!runId) {
    printError('Missing required argument: --run=<bundle_run_id>')
    console.log('\nUsage: jobforge console replay:export --run=<id> [--output=<path>]')
    process.exit(EXIT_CODES.validation)
  }

  printHeader('Export Replay Bundle')
  console.log(`Run ID: ${runId.slice(0, 16)}...`)

  try {
    const { JobForgeClient } = await loadSdkModule()

    const client = new JobForgeClient({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    })

    const job = await client.getJob(runId, config.tenantId)

    if (!job) {
      printError('Bundle run not found')
      process.exit(EXIT_CODES.validation)
    }

    // Build replay bundle
    const replayBundle = {
      version: '1.0',
      replay_id: `replay-${Date.now()}`,
      original_run_id: runId,
      tenant_id: job.tenant_id,
      project_id: job.payload?.project_id,
      captured_at: new Date().toISOString(),
      job_type: job.type,
      payload: job.payload,
      result: null as unknown,
    }

    // Get result if available
    if (job.result_id) {
      const result = await client.getResult(job.result_id, config.tenantId)
      replayBundle.result = result?.result || null
    }

    // Determine output path
    const finalOutputPath = outputPath || `replay-${runId.slice(0, 8)}.json`

    // Write to file
    fs.writeFileSync(finalOutputPath, JSON.stringify(replayBundle, null, 2))

    printSuccess(`Replay bundle exported to: ${finalOutputPath}`)
    printFooter()
  } catch (error) {
    logUnexpectedError('Export failed', error)
    process.exit(EXIT_CODES.failure)
  }
}

async function showImpact(config: ConsoleConfig, args: string[]): Promise<void> {
  const runArg = args.find((a) => a.startsWith('--run='))
  const runId = runArg ? runArg.split('=')[1] : undefined
  const jsonOutput = args.includes('--json')

  if (!runId) {
    printError('Missing required argument: --run=<bundle_run_id>')
    console.log('\nUsage: jobforge console impact:show --run=<id> [--json]')
    process.exit(EXIT_CODES.validation)
  }

  printHeader('Impact Graph')
  console.log(`Run ID: ${runId.slice(0, 16)}...`)

  try {
    const { JobForgeClient } = await loadSdkModule()
    const { buildImpactGraphFromBundleRun, formatImpactExportTree } = await loadSharedModule()

    const client = new JobForgeClient({
      supabaseUrl: config.supabaseUrl,
      supabaseKey: config.supabaseKey,
    })

    const job = await client.getJob(runId, config.tenantId)

    if (!job) {
      printError('Bundle run not found')
      process.exit(EXIT_CODES.validation)
    }

    const result = job.result_id ? await client.getResult(job.result_id, config.tenantId) : null
    const manifest = await client.getRunManifest({ run_id: runId, tenant_id: config.tenantId })

    const payload = job.payload as Record<string, unknown>
    const requestBundle =
      payload && typeof payload === 'object' && 'request_bundle' in payload
        ? (payload.request_bundle as Record<string, unknown>)
        : undefined

    const graph = buildImpactGraphFromBundleRun({
      run_id: job.id,
      tenant_id: job.tenant_id,
      project_id: (payload?.project_id as string | undefined) || undefined,
      trace_id: (payload?.trace_id as string | undefined) || undefined,
      bundle_run: {
        job_type: job.type,
        status: job.status,
        created_at: job.created_at,
        mode: typeof payload?.mode === 'string' ? payload.mode : undefined,
      },
      event: {
        id: typeof payload?.trace_id === 'string' ? payload.trace_id : undefined,
        type: 'bundle_request',
      },
      request_bundle:
        requestBundle && typeof requestBundle === 'object'
          ? (requestBundle as {
              bundle_id?: string
              trace_id?: string
              metadata?: Record<string, unknown>
              requests: Array<{
                id: string
                job_type: string
                tenant_id?: string
                project_id?: string
                payload?: Record<string, unknown>
                idempotency_key?: string
                required_scopes?: string[]
                is_action_job?: boolean
              }>
            })
          : undefined,
      child_runs: Array.isArray(result?.result?.child_runs)
        ? (result?.result?.child_runs as Array<{
            request_id: string
            job_type?: string
            status?: string
            job_id?: string
            reason?: string
          }>)
        : undefined,
      artifacts: manifest?.outputs || [],
    })

    if (jsonOutput) {
      console.log(JSON.stringify(graph, null, 2))
    } else {
      console.log(formatImpactExportTree(graph))
    }

    printFooter()
  } catch (error) {
    logUnexpectedError('Failed to show impact graph', error)
    process.exit(EXIT_CODES.failure)
  }
}

function showHelp(): void {
  console.log(`
JobForge Ops Console CLI

Description:
  Operator-friendly console for inspecting bundle runs, trigger rules, and replays.

USAGE:
  jobforge console <command> [options]

COMMANDS:
  bundles:list        List bundle runs
  bundles:show        Show bundle details
  triggers:list       List trigger rules
  triggers:show       Show trigger rule details
  triggers:dryrun     Test trigger rule against event
  replay:export       Export replay bundle for a run
  impact:show         Show impact graph tree for a bundle run
  status              Show feature flag status
  help                Show this help message

OPTIONS:
  --tenant=<id>       Tenant ID (required for data commands, or set JOBFORGE_TENANT_ID)
  --project=<id>      Project ID (optional, or set JOBFORGE_PROJECT_ID)
  --json              Output as JSON (redacted, default: false)
  --since=<time>      Filter by time (ISO format, default: none)
  --run=<id>          Bundle run ID (for bundles:show and replay:export)
  --run=<id>          Bundle run ID (for impact:show)
  --rule=<id>         Trigger rule ID (for triggers:show and triggers:dryrun)
  --event=<path>      Path to event JSON file (for triggers:dryrun)
  --output=<path>     Output file path (for replay:export)

ENVIRONMENT:
  SUPABASE_URL                  Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY     Supabase service role key (required)
  JOBFORGE_TENANT_ID            Default tenant ID
  JOBFORGE_PROJECT_ID           Default project ID

EXAMPLES:
  jobforge console bundles:list --tenant=550e8400-e29b-41d4-a716-446655440000
  jobforge console bundles:show --run=550e8400-e29b-41d4-a716-446655440001
  jobforge console triggers:list --tenant=550e8400-e29b-41d4-a716-446655440000
  jobforge console triggers:dryrun --rule=550e8400-e29b-41d4-a716-446655440002 --event=./event.json
  jobforge console impact:show --run=550e8400-e29b-41d4-a716-446655440001
`)
}

async function showStatus(): Promise<void> {
  printHeader('JobForge Ops Console Status')

  const { getExtendedFeatureFlagSummary, isBundleTriggersEnabled } = await loadSharedModule()

  const flags = getExtendedFeatureFlagSummary()

  console.log('\nFeature Flags:')
  for (const [key, value] of Object.entries(flags)) {
    const icon = typeof value === 'boolean' ? (value ? '✓' : '✗') : 'ℹ️'
    const displayValue = typeof value === 'boolean' ? '' : `: ${value}`
    console.log(`  ${icon} ${key}${displayValue}`)
  }

  console.log('\nBundle Triggers Enabled:', isBundleTriggersEnabled() ? '✓ Yes' : '✗ No')

  printFooter()
}

// ============================================================================
// Main CLI Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // Get command early for help/status
  const command = args[0]

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    showHelp()
    process.exit(EXIT_CODES.success)
  }

  if (command === 'status') {
    await showStatus()
    process.exit(EXIT_CODES.success)
  }

  // Parse global options
  const tenantArg = args.find((a) => a.startsWith('--tenant='))
  const projectArg = args.find((a) => a.startsWith('--project='))

  const config: ConsoleConfig = {
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    tenantId: tenantArg?.split('=')[1] || process.env.JOBFORGE_TENANT_ID || '',
    projectId: projectArg?.split('=')[1] || process.env.JOBFORGE_PROJECT_ID,
  }

  // Validate required config
  if (!config.supabaseUrl || !config.supabaseKey) {
    printError(
      'Missing required environment variables',
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
    )
    process.exit(EXIT_CODES.validation)
  }

  // Validate tenant for data commands
  const dataCommands = [
    'bundles:list',
    'bundles:show',
    'triggers:list',
    'triggers:show',
    'triggers:dryrun',
    'replay:export',
    'impact:show',
  ]
  if (dataCommands.includes(command) && !config.tenantId) {
    printError(
      'Missing tenant ID',
      'Provide --tenant=<id> or set JOBFORGE_TENANT_ID environment variable'
    )
    process.exit(EXIT_CODES.validation)
  }

  // Route to command handler
  try {
    switch (command) {
      case 'bundles:list':
        await listBundles(config, args)
        break
      case 'bundles:show':
        await showBundle(config, args)
        break
      case 'triggers:list':
        await listTriggers(config, args)
        break
      case 'triggers:show':
        await showTrigger(config, args)
        break
      case 'triggers:dryrun':
        await dryRunTrigger(config, args)
        break
      case 'replay:export':
        await exportReplay(config, args)
        break
      case 'impact:show':
        await showImpact(config, args)
        break
      default:
        printError(`Unknown command: ${command}`)
        console.log('\nRun "jobforge console help" for usage information.')
        process.exit(EXIT_CODES.validation)
    }
  } catch (error) {
    logUnexpectedError('Command failed', error)
    process.exit(EXIT_CODES.failure)
  }
}

main().catch((error) => {
  logUnexpectedError('Console crashed', error)
  process.exit(EXIT_CODES.failure)
})
