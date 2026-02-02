#!/usr/bin/env node
/**
 * JobForge Contract Test CLI
 * Run contract validation tests against fixture files
 */

import { runContractTests, formatContractReport } from '../src/contract-tests.js'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const fixturesDir = path.join(__dirname, '..', 'test', 'fixtures')

console.log('Running JobForge Contract Tests...')
console.log(`Fixtures directory: ${fixturesDir}`)

runContractTests(fixturesDir)
  .then((report) => {
    console.log(formatContractReport(report))
    process.exit(report.failed > 0 ? 1 : 0)
  })
  .catch((error) => {
    console.error('Contract tests failed:', error)
    process.exit(1)
  })
