#!/usr/bin/env node
/**
 * JobForge Contract Test CLI
 * Run contract validation tests against fixture files
 */

import { runContractTests, formatContractReport } from '../src/contract-tests.js'
import * as path from 'path'
import { fileURLToPath } from 'url'

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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
JobForge Contract Test CLI

Usage:
  node packages/shared/test/contract-test-runner.ts [options]

Options:
  --help, -h   Show this help and exit

Defaults:
  Fixtures directory: ${fixturesDir}

Examples:
  node packages/shared/test/contract-test-runner.ts
`)
  process.exit(EXIT_CODES.success)
}

console.log('Running JobForge Contract Tests...')
console.log(`Fixtures directory: ${fixturesDir}`)

runContractTests(fixturesDir)
  .then((report) => {
    console.log(formatContractReport(report))
    process.exit(report.failed > 0 ? EXIT_CODES.failure : EXIT_CODES.success)
  })
  .catch((error) => {
    logUnexpectedError('Contract tests failed', error)
    process.exit(EXIT_CODES.failure)
  })
