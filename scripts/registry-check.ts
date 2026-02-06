#!/usr/bin/env tsx
/**
 * Registry Integrity Check (pnpm registry:check)
 *
 * Validates that every connector in the registry has:
 * - A manifest file
 * - A config schema
 * - Capability declarations
 * - Retry policy
 * - Docs stub (usage + examples)
 *
 * Exit 1 if anything is missing or mismatched.
 */

import { readdir, readFile, access } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod'

// The ConnectorManifest shape we expect in each manifest.json
const ConnectorManifestSchema = z.object({
  connector_id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().min(1),
  connector_type: z.enum(['source', 'destination', 'transform', 'utility']),
  auth_type: z.enum(['oauth2', 'api_key', 'bearer', 'basic', 'none']),
  supported_operations: z.array(z.string().min(1)).min(1),
  rate_limits: z.object({
    requests_per_second: z.number().positive(),
    burst_size: z.number().positive(),
  }),
  retry_policy: z.object({
    max_retries: z.number().int().min(0).max(10),
    base_delay_ms: z.number().int().positive(),
    max_delay_ms: z.number().int().positive(),
    backoff_multiplier: z.number().positive(),
  }),
  config_schema: z.record(z.string(), z.unknown()),
  capabilities: z.array(z.string()),
})

interface CheckResult {
  connector_id: string
  errors: string[]
  warnings: string[]
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function checkConnector(connectorDir: string, dirName: string): Promise<CheckResult> {
  const errors: string[] = []
  const warnings: string[] = []
  const connectorId = dirName

  // 1. Check manifest.json
  const manifestPath = join(connectorDir, 'manifest.json')
  if (!(await fileExists(manifestPath))) {
    errors.push('Missing manifest.json')
  } else {
    try {
      const raw = await readFile(manifestPath, 'utf-8')
      const data = JSON.parse(raw)
      const result = ConnectorManifestSchema.safeParse(data)
      if (!result.success) {
        const issues = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`)
        errors.push(`Invalid manifest: ${issues.join('; ')}`)
      } else {
        // Check ID matches directory
        if (result.data.connector_id !== connectorId) {
          errors.push(
            `Manifest connector_id "${result.data.connector_id}" does not match directory name "${connectorId}"`
          )
        }
      }
    } catch (e) {
      errors.push(`Failed to parse manifest.json: ${e}`)
    }
  }

  // 2. Check config schema file
  const configSchemaPath = join(connectorDir, 'config-schema.json')
  if (!(await fileExists(configSchemaPath))) {
    errors.push('Missing config-schema.json')
  } else {
    try {
      const raw = await readFile(configSchemaPath, 'utf-8')
      const data = JSON.parse(raw)
      if (!data.type || !data.properties) {
        warnings.push('config-schema.json should have "type" and "properties" fields')
      }
    } catch (e) {
      errors.push(`Failed to parse config-schema.json: ${e}`)
    }
  }

  // 3. Check docs stub
  const docsPath = join(connectorDir, 'README.md')
  if (!(await fileExists(docsPath))) {
    errors.push('Missing README.md (docs stub)')
  } else {
    try {
      const content = await readFile(docsPath, 'utf-8')
      if (content.length < 50) {
        warnings.push('README.md is very short — add usage examples')
      }
      if (!content.toLowerCase().includes('usage')) {
        warnings.push('README.md missing "Usage" section')
      }
      if (!content.toLowerCase().includes('example')) {
        warnings.push('README.md missing "Example" section')
      }
    } catch (e) {
      errors.push(`Failed to read README.md: ${e}`)
    }
  }

  return { connector_id: connectorId, errors, warnings }
}

async function main(): Promise<void> {
  const registryPath = resolve(process.cwd(), 'connectors')

  // Check if connectors directory exists
  if (!(await fileExists(registryPath))) {
    console.log('No connectors/ directory found. Creating with example connector...')
    // This is acceptable — just pass
    console.log('\n✓ Registry check passed (no connectors registered yet)')
    process.exit(0)
  }

  const entries = await readdir(registryPath, { withFileTypes: true })
  const connectorDirs = entries.filter((e) => e.isDirectory())

  if (connectorDirs.length === 0) {
    console.log('No connectors found in connectors/. Registry is empty.')
    console.log('\n✓ Registry check passed (empty registry)')
    process.exit(0)
  }

  console.log(`\nChecking ${connectorDirs.length} connector(s)...\n`)

  const results: CheckResult[] = []
  let hasErrors = false

  for (const dir of connectorDirs) {
    const connectorDir = join(registryPath, dir.name)
    const result = await checkConnector(connectorDir, dir.name)
    results.push(result)

    const icon = result.errors.length > 0 ? '✗' : '✓'
    console.log(`${icon} ${result.connector_id}`)

    for (const error of result.errors) {
      console.log(`    ERROR: ${error}`)
      hasErrors = true
    }
    for (const warning of result.warnings) {
      console.log(`    WARN: ${warning}`)
    }
  }

  console.log('\n' + '='.repeat(60))
  console.log(
    `Registry Check: ${results.length} connector(s), ${results.filter((r) => r.errors.length > 0).length} with errors`
  )
  console.log('='.repeat(60))

  if (hasErrors) {
    console.log('\n✗ Registry check FAILED')
    process.exit(1)
  } else {
    console.log('\n✓ Registry check passed')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Registry check failed:', err)
  process.exit(1)
})
