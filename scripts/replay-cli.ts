#!/usr/bin/env tsx
/**
 * JobForge Replay CLI
 *
 * Commands:
 *   export <run-id>  - Export a replay bundle for a run
 *   dry-run <bundle> - Execute a dry-run replay from a bundle file
 *
 * Environment:
 *   REPLAY_PACK_ENABLED=1  - Required for export to work
 *   REPLAY_OUTPUT_DIR      - Directory for exported bundles (default: ./replays)
 *
 * Usage:
 *   tsx scripts/replay-cli.ts export run-123 --tenant tenant-1 --job http.request
 *   tsx scripts/replay-cli.ts dry-run ./replays/replay-run-123.json
 */

import { exportReplayBundle, replayDryRun, type ReplayBundle } from '../packages/shared/src/replay'
import { mkdir, writeFile, readFile } from 'fs/promises'
import { join } from 'path'

interface ExportOptions {
  tenantId: string
  jobType: string
  projectId?: string
  inputs?: string
  outputDir?: string
}

interface DryRunOptions {
  maxLogLines?: number
  compareResults?: boolean
}

async function exportCommand(runId: string, options: ExportOptions): Promise<void> {
  // Verify REPLAY_PACK_ENABLED
  if (process.env.REPLAY_PACK_ENABLED !== '1') {
    console.error('Error: REPLAY_PACK_ENABLED must be set to 1')
    console.error('Run with: REPLAY_PACK_ENABLED=1 tsx scripts/replay-cli.ts export ...')
    process.exit(1)
  }

  // Parse inputs
  let inputs: Record<string, unknown> = {}
  if (options.inputs) {
    try {
      inputs = JSON.parse(options.inputs)
    } catch {
      console.error('Error: Invalid JSON in --inputs')
      process.exit(1)
    }
  }

  // Create output directory
  const outputDir = options.outputDir || './replays'
  await mkdir(outputDir, { recursive: true })

  // Generate bundle
  const bundle = await exportReplayBundle(runId, options.tenantId, options.jobType, inputs, {
    projectId: options.projectId,
    exportedBy: 'replay-cli',
  })

  if (!bundle) {
    console.error('Error: Failed to generate replay bundle')
    process.exit(1)
  }

  // Write replay.json
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filename = `replay-${runId}-${timestamp}.json`
  const filepath = join(outputDir, filename)

  await writeFile(filepath, JSON.stringify(bundle, null, 2))

  // Write manifest.json
  const manifest = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    files: {
      'replay.json': filename,
    },
    runId,
    tenantId: options.tenantId,
    jobType: options.jobType,
  }

  const manifestPath = join(outputDir, `manifest-${runId}.json`)
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))

  console.log(`✓ Replay bundle exported to ${filepath}`)
  console.log(`✓ Manifest written to ${manifestPath}`)
  console.log(`\nBundle contents:`)
  console.log(`  - Run ID: ${bundle.provenance.runId}`)
  console.log(`  - Tenant: ${bundle.provenance.tenantId}`)
  console.log(`  - Job Type: ${bundle.provenance.jobType}`)
  console.log(`  - Input Hash: ${bundle.provenance.inputs.hash.slice(0, 16)}...`)
  console.log(`  - Git SHA: ${bundle.provenance.code.gitSha?.slice(0, 8) || 'N/A'}`)
  console.log(`  - Node Version: ${bundle.provenance.runtime.nodeVersion}`)
  console.log(
    `  - Lockfile Hash: ${bundle.provenance.dependencies.lockfileHash?.slice(0, 16) || 'N/A'}...`
  )
}

async function dryRunCommand(bundlePath: string, options: DryRunOptions): Promise<void> {
  // Read bundle
  let bundle: ReplayBundle
  try {
    const content = await readFile(bundlePath, 'utf-8')
    bundle = JSON.parse(content) as ReplayBundle
  } catch (error) {
    console.error(`Error: Failed to read bundle from ${bundlePath}`)
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }

  // Validate bundle
  if (!bundle.provenance || !bundle.version) {
    console.error('Error: Invalid replay bundle format')
    process.exit(1)
  }

  console.log(`Executing dry-run replay of run ${bundle.provenance.runId}...\n`)

  // Execute dry-run
  const result = await replayDryRun(bundle, {
    maxLogLines: options.maxLogLines,
    compareResults: options.compareResults,
  })

  // Print results
  console.log('='.repeat(60))
  console.log('REPLAY RESULTS')
  console.log('='.repeat(60))
  console.log(`Original Run ID: ${result.originalRunId}`)
  console.log(`Replay Run ID:   ${result.replayRunId}`)
  console.log(`Success:         ${result.success ? '✓ YES' : '✗ NO'}`)
  console.log(`Timestamp:       ${result.timestamp}`)

  if (result.differences.length > 0) {
    console.log(`\nDifferences detected (${result.differences.length}):`)
    for (const diff of result.differences) {
      console.log(`  - ${diff.field}:`)
      console.log(`      Original: ${String(diff.original).slice(0, 50)}`)
      console.log(`      Replay:   ${String(diff.replayed).slice(0, 50)}`)
    }
  } else {
    console.log('\nNo differences detected - replay environment matches original')
  }

  console.log(`\nLogs (${result.logs.length} lines):`)
  console.log('-'.repeat(60))
  for (const log of result.logs.slice(0, 20)) {
    console.log(log)
  }
  if (result.logs.length > 20) {
    console.log(`... ${result.logs.length - 20} more lines`)
  }
  console.log('-'.repeat(60))

  process.exit(result.success ? 0 : 1)
}

function showHelp(): void {
  console.log(`
JobForge Replay CLI

Commands:
  export <run-id>     Export a replay bundle for a run
  dry-run <bundle>    Execute a dry-run replay from a bundle file

Export Options:
  --tenant <id>       Tenant ID (required)
  --job <type>        Job type (required)
  --project <id>      Project ID (optional)
  --inputs <json>     JSON string of inputs (optional)
  --output <dir>      Output directory (default: ./replays)

Dry-Run Options:
  --max-logs <n>      Maximum log lines to show (default: 1000)
  --compare           Compare results with original

Examples:
  REPLAY_PACK_ENABLED=1 tsx scripts/replay-cli.ts export run-123 \\
    --tenant tenant-1 \\
    --job connector.http.request \\
    --inputs '{"url":"https://example.com"}'

  tsx scripts/replay-cli.ts dry-run ./replays/replay-run-123-2024-01-15.json

Environment:
  REPLAY_PACK_ENABLED=1    Required for export command
  REPLAY_OUTPUT_DIR        Default output directory
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    showHelp()
    process.exit(0)
  }

  // Parse options
  const options: Record<string, string> = {}
  let positional: string[] = []

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : 'true'
      options[key] = value
    } else {
      positional.push(arg)
    }
  }

  try {
    switch (command) {
      case 'export': {
        const runId = positional[0]
        if (!runId) {
          console.error('Error: run-id is required')
          process.exit(1)
        }
        if (!options.tenant) {
          console.error('Error: --tenant is required')
          process.exit(1)
        }
        if (!options.job) {
          console.error('Error: --job is required')
          process.exit(1)
        }

        await exportCommand(runId, {
          tenantId: options.tenant,
          jobType: options.job,
          projectId: options.project,
          inputs: options.inputs,
          outputDir: options.output || process.env.REPLAY_OUTPUT_DIR,
        })
        break
      }

      case 'dry-run': {
        const bundlePath = positional[0]
        if (!bundlePath) {
          console.error('Error: bundle path is required')
          process.exit(1)
        }

        await dryRunCommand(bundlePath, {
          maxLogLines: options['max-logs'] ? parseInt(options['max-logs'], 10) : undefined,
          compareResults: options.compare === 'true',
        })
        break
      }

      default:
        console.error(`Unknown command: ${command}`)
        showHelp()
        process.exit(1)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()
