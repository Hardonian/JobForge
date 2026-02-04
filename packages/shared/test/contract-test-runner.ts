#!/usr/bin/env node
/**
 * JobForge Contract Test CLI
 * Run contract validation tests against fixture files
 */

import { runContractTests, formatContractReport } from '../src/contract-tests.js'
import * as path from 'path'
import { existsSync } from 'fs'
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
const MODULES = ['ops', 'support', 'growth', 'finops'] as const

function resolveModuleRepoPaths(): Record<string, string> {
  const repoMap: Record<string, string> = {}

  if (process.env.JOBFORGE_MODULE_REPOS) {
    try {
      const parsed = JSON.parse(process.env.JOBFORGE_MODULE_REPOS)
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value.length > 0) {
            repoMap[key] = value
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse JOBFORGE_MODULE_REPOS JSON:', formatError(error))
    }
  }

  for (const moduleName of MODULES) {
    const envKey = `JOBFORGE_MODULE_${moduleName.toUpperCase()}_REPO`
    const value = process.env[envKey]
    if (value && value.length > 0) {
      repoMap[moduleName] = value
    }
  }

  return repoMap
}

function resolveModuleFixtureDirs(): string[] {
  const fixtureDirs: string[] = []
  const repoMap = resolveModuleRepoPaths()

  for (const [moduleName, repoPath] of Object.entries(repoMap)) {
    const resolved = path.isAbsolute(repoPath) ? repoPath : path.resolve(process.cwd(), repoPath)
    const moduleFixturesDir = path.join(resolved, 'fixtures', 'jobforge')
    if (!existsSync(moduleFixturesDir)) {
      console.warn(
        `Module fixtures not found for ${moduleName} at ${moduleFixturesDir}; using JobForge fixtures.`
      )
      continue
    }
    fixtureDirs.push(moduleFixturesDir)
  }

  return fixtureDirs
}

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

const moduleFixtureDirs = resolveModuleFixtureDirs()
const fixtureDirs = [fixturesDir, ...moduleFixtureDirs]

console.log('Running JobForge Contract Tests...')
console.log(`Fixtures directories:`)
for (const dir of fixtureDirs) {
  console.log(`  - ${dir}`)
}

runContractTests(fixtureDirs)
  .then((report) => {
    console.log(formatContractReport(report))
    process.exit(report.failed > 0 ? EXIT_CODES.failure : EXIT_CODES.success)
  })
  .catch((error) => {
    logUnexpectedError('Contract tests failed', error)
    process.exit(EXIT_CODES.failure)
  })
