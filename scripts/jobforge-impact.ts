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
 *   JOBFORGE_IMPACT_MAP_ENABLED=1 - Required for full functionality
 *
 * Usage:
 *   pnpm jobforge impact:show --run run-123
 *   pnpm jobforge impact:export --run run-123
 *   pnpm jobforge impact:compare --run-a run-1 --run-b run-2
 */

import {
  formatImpactTree,
  parseImpactGraph,
  compareImpactGraphs,
  exportImpactGraph,
  type ImpactGraph,
} from '../packages/shared/src/impact-map.js'
import { JOBFORGE_IMPACT_MAP_ENABLED } from '../packages/shared/src/feature-flags.js'
import { readFile, access } from 'fs/promises'

interface ShowOptions {
  runId: string
  tenantId: string
  projectId?: string
  json?: boolean
}

interface ExportOptions {
  runId: string
  outputDir?: string
}

interface CompareOptions {
  runA: string
  runB: string
  tenantId: string
}

async function loadImpactGraph(runId: string): Promise<ImpactGraph | null> {
  // Try to load from local artifacts
  const possiblePaths = [
    `.jobforge/impact/impact-${runId}.json`,
    `.jobforge/artifacts/verify-pack-impact-${runId}.json`,
    `.jobforge/artifacts/impact-${runId}.json`,
    `.jobforge/artifacts/impact-graph-${runId}.json`,
  ]

  for (const path of possiblePaths) {
    try {
      await access(path)
      const content = await readFile(path, 'utf-8')
      return parseImpactGraph(content)
    } catch {
      continue
    }
  }

  return null
}

async function showCommand(options: ShowOptions): Promise<void> {
  console.log(`Loading impact map for run ${options.runId}...\n`)

  const graph = await loadImpactGraph(options.runId)

  if (!graph) {
    console.error(`Error: Impact graph not found for run ${options.runId}`)
    console.error('')
    console.error('Searched locations:')
    console.error('  - .jobforge/impact/')
    console.error('  - .jobforge/artifacts/')
    console.error('')
    console.error('The impact map feature may be disabled or the run may not have generated one.')
    console.error(`JOBFORGE_IMPACT_MAP_ENABLED=${JOBFORGE_IMPACT_MAP_ENABLED ? '1' : '0'}`)
    process.exit(1)
  }

  if (options.json) {
    console.log(JSON.stringify(graph, null, 2))
  } else {
    console.log(formatImpactTree(graph))
  }
}

async function exportCommand(options: ExportOptions): Promise<void> {
  console.log(`Exporting impact map for run ${options.runId}...\n`)

  const graph = await loadImpactGraph(options.runId)

  if (!graph) {
    console.error(`Error: Impact graph not found for run ${options.runId}`)
    process.exit(1)
  }

  const outputDir = options.outputDir || '.jobforge/impact'
  const filepath = await exportImpactGraph(graph, outputDir)

  console.log(`✓ Exported to ${filepath}`)
  console.log('')
  console.log('Graph summary:')
  console.log(`  Nodes: ${graph.nodes.length}`)
  console.log(`  Edges: ${graph.edges.length}`)
  console.log(`  Tenant: ${graph.tenantId}`)
  console.log(`  Created: ${graph.createdAt}`)
}

async function compareCommand(options: CompareOptions): Promise<void> {
  console.log(`Comparing impact maps...`)
  console.log(`  Run A: ${options.runA}`)
  console.log(`  Run B: ${options.runB}\n`)

  const graphA = await loadImpactGraph(options.runA)
  const graphB = await loadImpactGraph(options.runB)

  if (!graphA) {
    console.error(`Error: Impact graph not found for run ${options.runA}`)
    process.exit(1)
  }

  if (!graphB) {
    console.error(`Error: Impact graph not found for run ${options.runB}`)
    process.exit(1)
  }

  const comparison = compareImpactGraphs(graphA, graphB)

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

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const command = args[0]

  if (!command || command === '--help' || command === '-h') {
    console.log(`
JobForge Impact Map CLI

Commands:
  show <run-id>     Show impact tree for a run
  export <run-id>   Export impact graph to JSON file
  compare <a> <b>   Compare two impact graphs

Show Options:
  --run <id>        Run ID (required)
  --tenant <id>     Tenant ID (optional, for info only)
  --project <id>    Project ID (optional)
  --json            Output JSON instead of tree

Export Options:
  --run <id>        Run ID (required)
  --output <dir>    Output directory (default: .jobforge/impact)

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
  - Impact maps are stored in .jobforge/impact/ or .jobforge/artifacts/
  - Feature flag JOBFORGE_IMPACT_MAP_ENABLED must be set
`)
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
      case 'show':
      case 'impact:show': {
        const runId = options.run || positional[0]
        if (!runId) {
          console.error('Error: --run is required')
          process.exit(1)
        }
        await showCommand({
          runId,
          tenantId: options.tenant || 'system',
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
          process.exit(1)
        }
        await exportCommand({
          runId,
          outputDir: options.output,
        })
        break
      }

      case 'compare':
      case 'impact:compare': {
        const runA = options['run-a'] || positional[0]
        const runB = options['run-b'] || positional[1]
        if (!runA || !runB) {
          console.error('Error: --run-a and --run-b are required')
          process.exit(1)
        }
        await compareCommand({
          runA,
          runB,
          tenantId: options.tenant || 'system',
        })
        break
      }

      default:
        console.error(`Unknown command: ${command}`)
        console.log('Run with --help for usage')
        process.exit(1)
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

main()
