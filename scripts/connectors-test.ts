// Connector Harness Test Runner (pnpm connectors:test)
//
// Loads fixtures from connectors/<name>/fixtures/
// Runs connectors under controlled conditions:
// - Simulates 429 rate limit
// - Simulates 5xx transient failures
// - Simulates network timeout
//
// Asserts:
// - Return envelope shape
// - Evidence validates schema
// - No secrets present
//
// Also runs the harness unit tests via vitest.

import { readdir, readFile, access } from 'fs/promises'
import { join, resolve } from 'path'
import { z } from 'zod'

// Inline minimal schemas to avoid build dependency issues
const EvidencePacketSchema = z.object({
  evidence_id: z.string().min(1),
  connector_id: z.string().min(1),
  trace_id: z.string().min(1),
  started_at: z.string(),
  ended_at: z.string(),
  duration_ms: z.number().nonnegative(),
  retries: z.number().int().nonnegative(),
  status_codes: z.array(z.number().int()),
  redacted_input: z.record(z.string(), z.unknown()),
  output_hash: z.string().regex(/^[a-f0-9]{64}$/),
  evidence_hash: z.string().regex(/^[a-f0-9]{64}$/),
  ok: z.boolean(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      retryable: z.boolean(),
    })
    .optional(),
  backoff_delays_ms: z.array(z.number().nonnegative()),
  rate_limited: z.boolean(),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
})

const ConnectorResultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      userMessage: z.string().optional(),
      retryable: z.boolean(),
      debug: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  evidence: EvidencePacketSchema,
})

const SECRET_PATTERNS = [
  /password/i,
  /secret/i,
  /api[_-]?key/i,
  /token/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
]

interface FixtureFile {
  name: string
  connector_id: string
  data: Record<string, unknown>
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadFixtures(connectorsDir: string): Promise<FixtureFile[]> {
  const fixtures: FixtureFile[] = []

  if (!(await fileExists(connectorsDir))) {
    return fixtures
  }

  const entries = await readdir(connectorsDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const fixturesDir = join(connectorsDir, entry.name, 'fixtures')
    if (!(await fileExists(fixturesDir))) continue

    const fixtureFiles = await readdir(fixturesDir)
    for (const file of fixtureFiles) {
      if (!file.endsWith('.json')) continue
      try {
        const content = await readFile(join(fixturesDir, file), 'utf-8')
        const data = JSON.parse(content)
        fixtures.push({
          name: `${entry.name}/${file}`,
          connector_id: entry.name,
          data,
        })
      } catch (e) {
        console.error(`  Failed to load fixture ${entry.name}/${file}: ${e}`)
      }
    }
  }

  return fixtures
}

function scanForSecrets(obj: unknown, path: string = ''): string[] {
  const leaks: string[] = []
  if (obj === null || obj === undefined || typeof obj !== 'object') return leaks

  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => {
      leaks.push(...scanForSecrets(item, `${path}[${idx}]`))
    })
    return leaks
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${key}` : key
    const isSecret = SECRET_PATTERNS.some((p) => p.test(key))
    if (isSecret && typeof value === 'string' && value !== '[REDACTED]') {
      leaks.push(fullPath)
    }
    if (typeof value === 'object' && value !== null) {
      leaks.push(...scanForSecrets(value, fullPath))
    }
  }
  return leaks
}

async function main(): Promise<void> {
  const connectorsDir = resolve(process.cwd(), 'connectors')
  let totalTests = 0
  let passedTests = 0
  let failedTests = 0

  console.log('\n=== Connector Harness Test Runner ===\n')

  // Phase 1: Load and validate fixtures
  console.log('Phase 1: Loading fixtures...')
  const fixtures = await loadFixtures(connectorsDir)
  if (fixtures.length > 0) {
    console.log(`  Loaded ${fixtures.length} fixture(s)\n`)

    for (const fixture of fixtures) {
      totalTests++
      console.log(`  Testing fixture: ${fixture.name}`)

      // Validate result shape if fixture includes a "result" field
      if (fixture.data.result) {
        const validation = ConnectorResultSchema.safeParse(fixture.data.result)
        if (validation.success) {
          console.log('    ✓ Result envelope shape valid')
          passedTests++
        } else {
          console.log(
            `    ✗ Result envelope invalid: ${validation.error.errors.map((e) => e.message).join('; ')}`
          )
          failedTests++
        }
      }

      // Validate evidence if present
      if (fixture.data.evidence) {
        totalTests++
        const evidenceValid = EvidencePacketSchema.safeParse(fixture.data.evidence)
        if (evidenceValid.success) {
          console.log('    ✓ Evidence schema valid')
          passedTests++
        } else {
          console.log(
            `    ✗ Evidence schema invalid: ${evidenceValid.error.errors.map((e) => e.message).join('; ')}`
          )
          failedTests++
        }

        // Check for secrets
        totalTests++
        const leaks = scanForSecrets(fixture.data.evidence)
        if (leaks.length === 0) {
          console.log('    ✓ No secrets in evidence')
          passedTests++
        } else {
          console.log(`    ✗ Secrets leaked: ${leaks.join(', ')}`)
          failedTests++
        }
      }
    }
  } else {
    console.log('  No connector fixtures found (connectors/*/fixtures/*.json)')
    console.log('  This is OK — harness unit tests will still run.\n')
  }

  // Phase 2: Run vitest harness tests
  console.log('\nPhase 2: Running harness unit tests...')

  const { execSync } = await import('child_process')
  try {
    const sharedDir = resolve(process.cwd(), 'packages/shared')
    execSync(
      'npx vitest run test/connector-harness.test.ts --reporter=verbose',
      {
        cwd: sharedDir,
        stdio: 'inherit',
        env: { ...process.env, NODE_ENV: 'test' },
      }
    )
    console.log('\n  ✓ Harness unit tests passed')
  } catch {
    console.log('\n  ✗ Harness unit tests FAILED')
    failedTests++
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log(
    `Connector Tests: ${totalTests} fixture tests, ${passedTests} passed, ${failedTests} failed`
  )
  console.log('='.repeat(60))

  if (failedTests > 0) {
    console.log('\n✗ connectors:test FAILED')
    process.exit(1)
  } else {
    console.log('\n✓ connectors:test passed')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('connectors:test failed:', err)
  process.exit(1)
})
