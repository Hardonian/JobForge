#!/usr/bin/env node
import { formatContractReport } from '@jobforge/shared'
import { runCompatibilityTests, resolveFixturesDir } from './index.js'

const EXIT_CODES = {
  success: 0,
  failure: 1,
}

const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  console.log(`
Autopilot Compatibility Runner

Usage:
  autopilot-compat [--fixtures <dir>]

Options:
  --fixtures <dir>  Path to fixtures directory (defaults to JobForge fixtures)
  --help, -h        Show this help
`)
  process.exit(EXIT_CODES.success)
}

const fixturesArgIndex = process.argv.findIndex((arg: string) => arg === '--fixtures')
const fixturesValue =
  fixturesArgIndex >= 0 ? process.argv[fixturesArgIndex + 1] : undefined

const fixturesDir = resolveFixturesDir(fixturesValue)

runCompatibilityTests({ fixturesDir })
  .then((report) => {
    console.log(formatContractReport(report))
    process.exit(report.failed > 0 ? EXIT_CODES.failure : EXIT_CODES.success)
  })
  .catch((error) => {
    console.error('Autopilot compatibility tests failed:', error)
    process.exit(EXIT_CODES.failure)
  })
