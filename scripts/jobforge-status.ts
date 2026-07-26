#!/usr/bin/env tsx
/** Safe repository status plus durable job retry/failure evidence export. */
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { buildOperatorStatus, type JobEvidence } from '../packages/shared/src/operator-status.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const value = (flag: string): string | undefined => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  const input = value('--input')
  if (!input) {
    const root = process.cwd()
    const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { version?: string }
    console.log(JSON.stringify({
      schema_version: '1.0', product: 'JobForge', scope: 'local_repository',
      status: existsSync(`${root}/packages/shared`) ? 'ready' : 'degraded',
      version: packageJson.version ?? 'unversioned', database_configured: Boolean(process.env.SUPABASE_URL),
      claims: { hosted: false, customer_proof: false, revenue_proof: false },
    }, null, 2))
    return
  }
  const output = value('--out') ?? '.jobforge/operator-status.json'
  const parsed = JSON.parse(await readFile(input, 'utf8')) as JobEvidence[] | { jobs: JobEvidence[] }
  const report = buildOperatorStatus(Array.isArray(parsed) ? parsed : parsed.jobs)
  await writeFile(output, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ output, total: report.total, retryable_failures: report.retryableFailures.length, terminal_failures: report.terminalFailures.length }))
}

void main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
