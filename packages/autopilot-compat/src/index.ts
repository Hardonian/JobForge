import path from 'path'
import { fileURLToPath } from 'url'
import { formatContractReport, runContractTests, type ContractTestReport } from '@jobforge/shared'
import { getFixturesRoot } from '@jobforge/autopilot-fixtures'

export interface CompatibilityOptions {
  fixturesDir?: string
}

export async function runCompatibilityTests(
  options: CompatibilityOptions = {}
): Promise<ContractTestReport> {
  const fixturesDir = options.fixturesDir ?? getFixturesRoot()
  return runContractTests(fixturesDir)
}

export async function formatCompatibilityReport(
  options: CompatibilityOptions = {}
): Promise<string> {
  const report = await runCompatibilityTests(options)
  return formatContractReport(report)
}

export function resolveFixturesDir(input?: string): string {
  if (!input) return getFixturesRoot()
  if (path.isAbsolute(input)) return input
  const baseDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(baseDir, input)
}
