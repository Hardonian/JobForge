#!/usr/bin/env tsx
/**
 * JobForge Impact Map CLI
 *
 * Commands:
 *   show <run-id>     - Show impact tree for a run
 *   export <run-id>   - Export impact graph to JSON
 *   compare <run-a> <run-b> - Compare two impact graphs
 *
 * Environment:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - For live bundle run lookup
 *
 * Usage:
 *   pnpm jobforge impact:show --run run-123
 *   pnpm jobforge impact:export --run run-123 --out .jobforge/impact
 *   pnpm jobforge impact:compare --run-a run-1 --run-b run-2
 */

import { mkdir, readFile, access, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  buildImpactGraphFromBundleRun,
  formatImpactTree,
  type ImpactBundleRunSnapshot,
  type ImpactExportGraph,
} from '../packages/shared/src/impact-export.js'

interface ShowOptions {
  runId: string
  tenantId?: string
  projectId?: string
  json?: boolean
}

interface ExportOptions {
  runId: string
  outputDir?: string
  tenantId?: string
}

interface CompareOptions {
  runA: string
  runB: string
  tenantId?: string
}

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

async function loadBundleRunSnapshot(runId: string): Promise<ImpactBundleRunSnapshot | null> {
  const possiblePaths = [
    `.jobforge/impact/${runId}.json`,
    `.jobforge/impact/bundle-run-${runId}.json`,
    `.jobforge/artifacts/${runId}.json`,
    `.jobforge/artifacts/bundle-run-${runId}.json`,
    `examples/fixtures/impact/${runId}.json`,
    `examples/fixtures/impact/bundle-run-${runId}.json`,
  ]

  for (const path of possiblePaths) {
    try {
      await access(path)
      const content = await readFile(path, 'utf-8')
      return JSON.parse(content) as ImpactBundleRunSnapshot
    } catch {
      continue
    }
  }

  return null
}

async function loadBundleRunSnapshotFromSupabase(
  runId: string,
  tenantId: string
): Promise<ImpactBundleRunSnapshot | null> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseKey) {
    return null
  }

  const { JobForgeClient } = await import('../packages/sdk-ts/src/index.js')
  const client = new JobForgeClient({ supabaseUrl, supabaseKey })
  const job = await client.getJob(runId, tenantId)
  if (!job) return null

  const result = job.result_id ? await client.getResult(job.result_id, tenantId) : null
  const manifest = await client.getRunManifest({ run_id: runId, tenant_id: tenantId })

  const payload = job.payload as Record<string, unknown>
  const requestBundle =
    payload && typeof payload === 'object' && 'request_bundle' in payload
      ? (payload.request_bundle as ImpactBundleRunSnapshot['request_bundle'])
      : undefined

  return {
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
    request_bundle: requestBundle,
    child_runs: Array.isArray(result?.result?.child_runs)
      ? (result?.result?.child_runs as ImpactBundleRunSnapshot['child_runs'])
      : undefined,
    artifacts: manifest?.outputs || [],
  }
}

async function resolveBundleRunSnapshot(
  runId: string,
  tenantId?: string
): Promise<ImpactBundleRunSnapshot | null> {
  if (tenantId) {
    const fromSupabase = await loadBundleRunSnapshotFromSupabase(runId, tenantId)
    if (fromSupabase) return fromSupabase
  }
  return loadBundleRunSnapshot(runId)
}

async function showCommand(options: ShowOptions): Promise<void> {
  console.log(`Loading impact map for run ${options.runId}...\n`)

  const snapshot = await resolveBundleRunSnapshot(options.runId, options.tenantId)

  if (!snapshot) {
    console.error(`Error: Bundle run snapshot not found for run ${options.runId}`)
    console.error('')
    console.error('Searched locations:')
    console.error('  - .jobforge/impact/')
    console.error('  - .jobforge/artifacts/')
    process.exit(EXIT_CODES.validation)
  }

  const graph = buildImpactGraphFromBundleRun(snapshot)

  if (options.json) {
    console.log(JSON.stringify(graph, null, 2))
  } else {
    console.log(formatImpactTree(graph))
  }
}

async function exportCommand(options: ExportOptions): Promise<void> {
  console.log(`Exporting impact map for run ${options.runId}...\n`)

  const snapshot = await resolveBundleRunSnapshot(options.runId, options.tenantId)

  if (!snapshot) {
    console.error(`Error: Bundle run snapshot not found for run ${options.runId}`)
    process.exit(EXIT_CODES.validation)
  }

  const graph = buildImpactGraphFromBundleRun(snapshot)
  const outputDir = options.outputDir || '.jobforge/impact'
  await mkdir(outputDir, { recursive: true })
  const filepath = join(outputDir, 'impact.json')
  await writeFile(filepath, JSON.stringify(graph, null, 2))

  console.log(`✓ Exported to ${filepath}`)
  console.log('')
  console.log('Graph summary:')
  console.log(`  Nodes: ${graph.nodes.length}`)
  console.log(`  Edges: ${graph.edges.length}`)
  console.log(`  Tenant: ${graph.tenant_id}`)
  if (graph.trace_id) {
    console.log(`  Trace: ${graph.trace_id}`)
  }
}

async function compareCommand(options: CompareOptions): Promise<void> {
  console.log(`Comparing impact maps...`)
  console.log(`  Run A: ${options.runA}`)
  console.log(`  Run B: ${options.runB}\n`)

  const snapshotA = await resolveBundleRunSnapshot(options.runA, options.tenantId)
  const snapshotB = await resolveBundleRunSnapshot(options.runB, options.tenantId)

  if (!snapshotA) {
    console.error(`Error: Bundle run snapshot not found for run ${options.runA}`)
    process.exit(EXIT_CODES.validation)
  }

  if (!snapshotB) {
    console.error(`Error: Bundle run snapshot not found for run ${options.runB}`)
    process.exit(EXIT_CODES.validation)
  }

  const graphA = buildImpactGraphFromBundleRun(snapshotA)
  const graphB = buildImpactGraphFromBundleRun(snapshotB)
  const comparison = compareGraphs(graphA, graphB)

  console.log('='.repeat(60))
  console.log('COMPARISON RESULTS')
  console.log('='.repeat(60))
  console.log(`Identical: ${comparison.identical ? 'YES' : 'NO'}`)
  console.log('')

  if (comparison.nodeDifferences.length > 0) {
    console.log(`Node Differences (${comparison.nodeDifferences.length}):`)
    for (const diff of comparison.nodeDifferences.slice(0, 10)) {
      console.log(`  - ${diff.id}:`)
      console.log(`      A: ${diff.hashA.slice(0, 16)}...`)
      console.log(`      B: ${diff.hashB.slice(0, 16)}...`)
    }
    if (comparison.nodeDifferences.length > 10) {
      console.log(`  ... and ${comparison.nodeDifferences.length - 10} more`)
    }
    console.log('')
  }

  if (comparison.edgeDifferences.length > 0) {
    console.log(`Edge Differences (${comparison.edgeDifferences.length}):`)
    for (const diff of comparison.edgeDifferences) {
      console.log(`  - ${diff.type}: inA=${diff.inA}, inB=${diff.inB}`)
    }
    console.log('')
  }

  if (comparison.identical) {
    console.log('✓ No differences detected - runs produced identical impact graphs')
  }
}

function compareGraphs(
  graphA: ImpactExportGraph,
  graphB: ImpactExportGraph
): {
  identical: boolean
  nodeDifferences: Array<{ id: string; hashA: string; hashB: string }>
  edgeDifferences: Array<{ id: string; hashA: string; hashB: string }>
} {
  const nodeAHashes = new Map(graphA.nodes.map((n) => [n.id, n.hash]))
  const nodeBHashes = new Map(graphB.nodes.map((n) => [n.id, n.hash]))

  const nodeDifferences: Array<{ id: string; hashA: string; hashB: string }> = []
  for (const [id, hashA] of nodeAHashes) {
    const hashB = nodeBHashes.get(id)
    if (hashB !== hashA) {
      nodeDifferences.push({ id, hashA, hashB: hashB || 'missing' })
    }
  }
  for (const [id, hashB] of nodeBHashes) {
    if (!nodeAHashes.has(id)) {
      nodeDifferences.push({ id, hashA: 'missing', hashB })
    }
  }

  const edgeAHashes = new Map(graphA.edges.map((e) => [e.id, e.hash]))
  const edgeBHashes = new Map(graphB.edges.map((e) => [e.id, e.hash]))
  const edgeDifferences: Array<{ id: string; hashA: string; hashB: string }> = []
  for (const [id, hashA] of edgeAHashes) {
    const hashB = edgeBHashes.get(id)
    if (hashB !== hashA) {
      edgeDifferences.push({ id, hashA, hashB: hashB || 'missing' })
    }
  }
  for (const [id, hashB] of edgeBHashes) {
    if (!edgeAHashes.has(id)) {
      edgeDifferences.push({ id, hashA: 'missing', hashB })
    }
  }

  return {
    identical: nodeDifferences.length === 0 && edgeDifferences.length === 0,
    nodeDifferences,
    edgeDifferences,
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    console.log(`
JobForge Impact Map CLI

Description:
  Inspect, export, and compare impact graphs generated by JobForge runs.

Commands:
  show <run-id>     Show impact tree for a run
  export <run-id>   Export impact graph to JSON file
  compare <a> <b>   Compare two impact graphs

Show Options:
  --run <id>        Run ID (required)
  --tenant <id>     Tenant ID (optional, for info only)
  --project <id>    Project ID (optional)
  --json            Output JSON instead of tree (default: false)

Export Options:
  --run <id>        Run ID (required)
  --out <dir>       Output directory (default: .jobforge/impact)
  --output <dir>    Output directory (alias)
  --tenant <id>     Tenant ID (optional, required for Supabase lookup)

Compare Options:
  --run-a <id>      First run ID (required)
  --run-b <id>      Second run ID (required)
  --tenant <id>     Tenant ID (optional)

Environment:
  JOBFORGE_IMPACT_MAP_ENABLED=1  Enable impact mapping

Examples:
  # Show impact tree
  JOBFORGE_IMPACT_MAP_ENABLED=1 pnpm jobforge impact:show --run abc-123

  # Export to JSON
  pnpm jobforge impact:export --run abc-123

  # Compare two runs
  pnpm jobforge impact:compare --run-a run-1 --run-b run-2

Notes:
  - Bundle run snapshots can be loaded from .jobforge/impact/, .jobforge/artifacts/,
    or Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.
`)
    process.exit(EXIT_CODES.success)
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
      case 'show':
      case 'impact:show': {
        const runId = options.run || positional[0]
        if (!runId) {
          console.error('Error: --run is required')
          process.exit(EXIT_CODES.validation)
        }
        await showCommand({
          runId,
          tenantId: options.tenant,
          projectId: options.project,
          json: options.json === 'true',
        })
        break
      }

      case 'export':
      case 'impact:export': {
        const runId = options.run || positional[0]
        if (!runId) {
          console.error('Error: --run is required')
          process.exit(EXIT_CODES.validation)
        }
        await exportCommand({
          runId,
          outputDir: options.out || options.output,
          tenantId: options.tenant,
        })
        break
      }

      case 'compare':
      case 'impact:compare': {
        const runA = options['run-a'] || positional[0]
        const runB = options['run-b'] || positional[1]
        if (!runA || !runB) {
          console.error('Error: --run-a and --run-b are required')
          process.exit(EXIT_CODES.validation)
        }
        await compareCommand({
          runA,
          runB,
          tenantId: options.tenant,
        })
        break
      }

      default:
        console.error(`Unknown command: ${command}`)
        console.log('Run with --help for usage')
        process.exit(EXIT_CODES.validation)
    }
  } catch (error) {
    logUnexpectedError('Error', error)
    process.exit(EXIT_CODES.failure)
  }
}

main()
