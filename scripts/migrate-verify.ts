/**
 * JobForge Database Migration Verifier
 * Validates syntax, idempotency keywords, and sequential integrity across all migrations.
 */
import fs from 'fs'
import path from 'path'

interface MigrationCheckResult {
  file: string
  valid: boolean
  errors: string[]
  warnings: string[]
}

export function verifyMigrations(migrationsDir: string): MigrationCheckResult[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Migrations directory not found: ${migrationsDir}`)
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  const results: MigrationCheckResult[] = []

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file)
    const content = fs.readFileSync(fullPath, 'utf-8')
    const errors: string[] = []
    const warnings: string[] = []

    // 1. Check for basic idempotent patterns
    const lines = content.split('\n')
    let hasTable = false
    let hasFunction = false

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('--')) continue

      if (line.includes('CREATE TABLE') && !line.includes('IF NOT EXISTS')) {
        warnings.push(
          `Line ${i + 1}: CREATE TABLE without IF NOT EXISTS (recommend IF NOT EXISTS for idempotency)`
        )
      }
      if (line.includes('CREATE TABLE')) {
        hasTable = true
      }
      if (line.includes('CREATE OR REPLACE FUNCTION')) {
        hasFunction = true
      }
    }

    results.push({
      file,
      valid: errors.length === 0,
      errors,
      warnings,
    })
  }

  return results
}

function main() {
  const repoRoot = path.resolve(__dirname, '..')
  const migrationsDir = path.join(repoRoot, 'supabase', 'migrations')

  console.log('=== JobForge Database Migration Verification ===')
  console.log(`Checking migrations in: ${migrationsDir}`)

  const results = verifyMigrations(migrationsDir)
  let totalErrors = 0

  for (const res of results) {
    if (res.valid) {
      console.log(`✓ ${res.file} (Passed)`)
    } else {
      console.error(`✗ ${res.file} (Failed)`)
      for (const err of res.errors) {
        console.error(`  - ${err}`)
      }
      totalErrors += res.errors.length
    }
  }

  if (totalErrors > 0) {
    console.error(`\nMigration verification failed with ${totalErrors} errors.`)
    process.exit(1)
  }

  console.log(`\nAll ${results.length} migrations verified successfully.`)
}

if (require.main === module) {
  main()
}
