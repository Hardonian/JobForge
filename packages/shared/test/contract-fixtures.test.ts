/**
 * Contract fixture validation tests
 */

import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  validateBundle,
  simulateExecutorValidation,
  checkDeterministicHashing,
  runExecutorPreflight,
} from '../src/contract-tests.js'
import { RunManifestSchema } from '@autopilot/contracts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const fixturesDir = path.join(__dirname, 'fixtures')
const manifestFixturesDir = path.join(fixturesDir, 'manifests')

async function loadFixture<T>(name: string): Promise<T> {
  const content = await readFile(path.join(fixturesDir, name), 'utf-8')
  return JSON.parse(content) as T
}

async function loadManifestFixture<T>(name: string): Promise<T> {
  const content = await readFile(path.join(manifestFixturesDir, name), 'utf-8')
  return JSON.parse(content) as T
}

describe('Contract Fixtures', () => {
  const validBundles = [
    'ops-autopilot-safe.json',
    'ops-autopilot-dry-run.json',
    'support-autopilot-safe.json',
    'support-autopilot-dry-run.json',
    'growth-autopilot-safe.json',
    'growth-autopilot-dry-run.json',
    'finops-autopilot-safe.json',
    'finops-autopilot-dry-run.json',
  ]

  const actionBundles = ['ops-autopilot-action.json', 'support-autopilot-action.json']

  const invalidBundles: Array<[string, RegExp]> = [
    ['invalid-wrong-tenant.json', /tenant/i],
    ['invalid-wrong-schema-version.json', /schema_version|Invalid literal/i],
    ['invalid-missing-idempotency.json', /idempotency_key/i],
    ['invalid-oversize-payload.json', /Payload too large/i],
  ]

  const manifestFixtures = ['verify-pack-manifest.json', 'bundle-run-manifest.json']

  it('accepts valid bundles', async () => {
    for (const fixture of validBundles) {
      const bundle = await loadFixture<unknown>(fixture)
      const result = validateBundle(bundle)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    }
  })

  it('blocks action bundles without policy token', async () => {
    for (const fixture of actionBundles) {
      const bundle = await loadFixture<unknown>(fixture)
      const validation = validateBundle(bundle)
      expect(validation.valid).toBe(true)

      const executor = simulateExecutorValidation(bundle as any)
      expect(executor.valid).toBe(false)
      expect(executor.blocked.some((reason) => reason.includes('Action job blocked'))).toBe(true)
    }
  })

  it('rejects invalid bundles with explicit reasons', async () => {
    for (const [fixture, pattern] of invalidBundles) {
      const bundle = await loadFixture<unknown>(fixture)
      const result = validateBundle(bundle)
      expect(result.valid).toBe(false)
      expect(result.errors.some((error) => pattern.test(error))).toBe(true)
    }
  })

  it('produces stable hashes for valid bundles', async () => {
    for (const fixture of validBundles) {
      const bundle = await loadFixture<unknown>(fixture)
      const first = checkDeterministicHashing(bundle as any)
      const second = checkDeterministicHashing(bundle as any)
      expect(first.stable).toBe(true)
      expect(first.hash).toBe(second.hash)
    }
  })

  it('passes executor preflight for valid bundles', async () => {
    for (const fixture of [...validBundles, ...actionBundles]) {
      const bundle = await loadFixture<unknown>(fixture)
      const validation = validateBundle(bundle)
      expect(validation.valid).toBe(true)

      const preflight = runExecutorPreflight(bundle as any)
      expect(preflight.valid).toBe(true)
    }
  })

  it('validates manifest fixtures', async () => {
    for (const fixture of manifestFixtures) {
      const manifest = await loadManifestFixture<unknown>(fixture)
      const result = RunManifestSchema.safeParse(manifest)
      expect(result.success).toBe(true)
    }
  })
})
