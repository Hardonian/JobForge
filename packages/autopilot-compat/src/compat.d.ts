declare module '@jobforge/shared' {
  export interface ContractTestReport {
    failed: number
    [key: string]: unknown
  }

  export function runContractTests(fixturesDir: string): Promise<ContractTestReport>
  export function formatContractReport(report: ContractTestReport): string
}

declare module '@jobforge/autopilot-fixtures' {
  export function getFixturesRoot(): string
}
