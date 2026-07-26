#!/usr/bin/env tsx
/** Safe, read-only JobForge repository status snapshot. */
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageJson = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as { version?: string }
console.log(JSON.stringify({
  schema_version: '1.0',
  product: 'JobForge',
  scope: 'local_repository',
  status: existsSync(`${root}/packages/shared`) ? 'ready' : 'degraded',
  version: packageJson.version ?? 'unversioned',
  database_configured: Boolean(process.env.SUPABASE_URL),
  claims: { hosted: false, customer_proof: false, revenue_proof: false },
}, null, 2))
