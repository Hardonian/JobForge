import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildImpactGraphFromBundleRun, type ImpactBundleRunSnapshot } from '../src/impact-export'

const fixturePath = join(
  process.cwd(),
  'examples',
  'fixtures',
  'impact',
  'bundle-run-001.json'
)
const outputPath = join(process.cwd(), 'examples', 'output', 'impact-bundle-run-001.json')

describe('Impact export graph', () => {
  it('builds deterministic impact graph output', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as ImpactBundleRunSnapshot
    const expected = JSON.parse(readFileSync(outputPath, 'utf-8'))

    const graph = buildImpactGraphFromBundleRun(fixture)

    expect(graph).toEqual(expected)
  })

  it('stabilizes ordering and hashes across input ordering changes', () => {
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8')) as ImpactBundleRunSnapshot
    const expected = JSON.parse(readFileSync(outputPath, 'utf-8'))

    const shuffled: ImpactBundleRunSnapshot = {
      ...fixture,
      request_bundle: fixture.request_bundle
        ? {
            ...fixture.request_bundle,
            requests: [...fixture.request_bundle.requests].reverse(),
          }
        : undefined,
      child_runs: fixture.child_runs ? [...fixture.child_runs].reverse() : undefined,
      artifacts: fixture.artifacts ? [...fixture.artifacts].reverse() : undefined,
    }

    const graph = buildImpactGraphFromBundleRun(shuffled)

    expect(graph).toEqual(expected)
  })
})
