import { readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

const fixturesRoot = fileURLToPath(new URL('../../shared/test/fixtures', import.meta.url))
const manifestsRoot = path.join(fixturesRoot, 'manifests')

export const fixturePaths = {
  opsDryRun: path.join(fixturesRoot, 'ops-autopilot-dry-run.json'),
  opsSafe: path.join(fixturesRoot, 'ops-autopilot-safe.json'),
  opsAction: path.join(fixturesRoot, 'ops-autopilot-action.json'),
  supportDryRun: path.join(fixturesRoot, 'support-autopilot-dry-run.json'),
  supportSafe: path.join(fixturesRoot, 'support-autopilot-safe.json'),
  supportAction: path.join(fixturesRoot, 'support-autopilot-action.json'),
  growthDryRun: path.join(fixturesRoot, 'growth-autopilot-dry-run.json'),
  growthSafe: path.join(fixturesRoot, 'growth-autopilot-safe.json'),
  finopsDryRun: path.join(fixturesRoot, 'finops-autopilot-dry-run.json'),
  finopsSafe: path.join(fixturesRoot, 'finops-autopilot-safe.json'),
  invalidMissingIdempotency: path.join(fixturesRoot, 'invalid-missing-idempotency.json'),
  invalidWrongSchemaVersion: path.join(fixturesRoot, 'invalid-wrong-schema-version.json'),
  invalidWrongTenant: path.join(fixturesRoot, 'invalid-wrong-tenant.json'),
  invalidOversizePayload: path.join(fixturesRoot, 'invalid-oversize-payload.json'),
  bundleRunManifest: path.join(manifestsRoot, 'bundle-run-manifest.json'),
  verifyPackManifest: path.join(manifestsRoot, 'verify-pack-manifest.json'),
} as const

export type FixtureKey = keyof typeof fixturePaths

export function getFixturesRoot(): string {
  return fixturesRoot
}

export function listFixtureKeys(): FixtureKey[] {
  return Object.keys(fixturePaths) as FixtureKey[]
}

export async function loadFixture<T = unknown>(fixtureKey: FixtureKey): Promise<T> {
  const filePath = fixturePaths[fixtureKey]
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content) as T
}

export function getFixturePath(fixtureKey: FixtureKey): string {
  return fixturePaths[fixtureKey]
}

export function listFixturePaths(): string[] {
  return Object.values(fixturePaths)
}
