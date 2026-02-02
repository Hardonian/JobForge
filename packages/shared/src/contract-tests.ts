/**
 * JobForge Contract Test Harness
 * Validates runnerless module outputs against @autopilot/contracts
 */

import { z } from 'zod'
import { JobRequestBundleSchema, type JobRequestBundle } from './execution-plane/schemas.js'

// ============================================================================
// Contract Validation Types
// ============================================================================

export interface ContractValidationResult {
  fixture_name: string
  valid: boolean
  errors: string[]
  warnings: string[]
  summary: {
    total_requests: number
    action_jobs: number
    dry_run_jobs: number
    required_scopes: string[]
  }
}

export interface ContractTestReport {
  passed: number
  failed: number
  total: number
  results: ContractValidationResult[]
  timestamp: string
}

// ============================================================================
// Extended Validation Schemas
// ============================================================================

const canonicalJsonSchema = z.object({
  version: z.literal('1.0'),
  bundle_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  trace_id: z.string().min(1),
  requests: z.array(z.any()).min(1).max(100),
  metadata: z.object({
    source: z.string(),
    triggered_at: z.string().datetime(),
    correlation_id: z.string().optional(),
  }),
})

const stableIdPattern = /^[a-z0-9-]+$/

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a JobRequestBundle against canonical schema
 */
export function validateBundle(bundle: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  // Primary schema validation
  const result = JobRequestBundleSchema.safeParse(bundle)
  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
    return { valid: false, errors }
  }

  const validBundle = result.data

  // Canonical JSON validation
  const canonicalResult = canonicalJsonSchema.safeParse(bundle)
  if (!canonicalResult.success) {
    errors.push('Bundle does not conform to canonical JSON structure')
  }

  // Stable ID validation for bundle_id
  if (!stableIdPattern.test(validBundle.bundle_id)) {
    errors.push('bundle_id should use stable format (lowercase alphanumeric with hyphens)')
  }

  // Tenant/project consistency validation
  const tenantIds = new Set<string>([validBundle.tenant_id])
  const projectIds = new Set<string | undefined>([validBundle.project_id])

  for (const request of validBundle.requests) {
    tenantIds.add(request.tenant_id)
    projectIds.add(request.project_id)
  }

  if (tenantIds.size > 1) {
    errors.push('All requests must have the same tenant_id as the bundle')
  }

  if (validBundle.project_id) {
    const uniqueProjects = Array.from(projectIds).filter((p): p is string => p !== undefined)
    if (uniqueProjects.length > 1) {
      errors.push('All requests must have the same project_id when bundle has project_id')
    }
  }

  // Duplicate ID validation
  const requestIds = new Set<string>()
  const idempotencyKeys = new Set<string>()

  for (const request of validBundle.requests) {
    if (requestIds.has(request.id)) {
      errors.push(`Duplicate request ID: ${request.id}`)
    }
    requestIds.add(request.id)

    if (request.idempotency_key) {
      if (idempotencyKeys.has(request.idempotency_key)) {
        errors.push(`Duplicate idempotency key: ${request.idempotency_key}`)
      }
      idempotencyKeys.add(request.idempotency_key)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Simulate executor validation step
 */
export function simulateExecutorValidation(
  bundle: JobRequestBundle,
  options?: {
    policyTokenPresent?: boolean
    requiredTenantId?: string
    requiredProjectId?: string
  }
): { valid: boolean; errors: string[]; blocked: string[] } {
  const errors: string[] = []
  const blocked: string[] = []

  // Tenant scoping check
  if (options?.requiredTenantId && bundle.tenant_id !== options.requiredTenantId) {
    errors.push(`Tenant mismatch: expected ${options.requiredTenantId}, got ${bundle.tenant_id}`)
  }

  // Project scoping check
  if (options?.requiredProjectId && bundle.project_id !== options.requiredProjectId) {
    errors.push(`Project mismatch: expected ${options.requiredProjectId}, got ${bundle.project_id}`)
  }

  // Policy token check for action jobs
  const actionJobs = bundle.requests.filter((r) => r.is_action_job)
  if (actionJobs.length > 0 && !options?.policyTokenPresent) {
    for (const job of actionJobs) {
      blocked.push(`Action job blocked (no policy token): ${job.id} (${job.job_type})`)
    }
  }

  // Scope validation
  const allScopes = new Set<string>()
  for (const request of bundle.requests) {
    for (const scope of request.required_scopes) {
      allScopes.add(scope)
    }
  }

  return { valid: errors.length === 0 && blocked.length === 0, errors, blocked }
}

/**
 * Check for deterministic hashing (canonical JSON)
 */
export function checkDeterministicHashing(bundle: JobRequestBundle): {
  stable: boolean
  issues: string[]
  hash: string
} {
  const issues: string[] = []

  // Sort keys for canonical form
  const canonical = JSON.stringify(bundle, Object.keys(bundle).sort())

  // Check for common non-deterministic patterns
  const jsonStr = JSON.stringify(bundle)

  // Check for timestamps that might vary
  if (jsonStr.includes('Date.now()') || jsonStr.includes('new Date()')) {
    issues.push('Bundle contains dynamic timestamp generation')
  }

  // Check for random values
  if (jsonStr.includes('Math.random()') || jsonStr.includes('randomUUID()')) {
    issues.push('Bundle contains random value generation')
  }

  // Generate simple hash
  let hash = 0
  for (let i = 0; i < canonical.length; i++) {
    const char = canonical.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }

  return {
    stable: issues.length === 0,
    issues,
    hash: hash.toString(16).padStart(16, '0'),
  }
}

/**
 * Full contract validation of a fixture
 */
export function validateContract(fixtureName: string, bundle: unknown): ContractValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Step 1: Bundle validation
  const bundleValidation = validateBundle(bundle)
  errors.push(...bundleValidation.errors)

  if (!bundleValidation.valid) {
    return {
      fixture_name: fixtureName,
      valid: false,
      errors,
      warnings,
      summary: {
        total_requests: 0,
        action_jobs: 0,
        dry_run_jobs: 0,
        required_scopes: [],
      },
    }
  }

  const validBundle = bundle as JobRequestBundle

  // Step 2: Executor simulation
  const executorValidation = simulateExecutorValidation(validBundle)
  if (!executorValidation.valid) {
    errors.push(...executorValidation.errors)
  }
  if (executorValidation.blocked.length > 0) {
    warnings.push(...executorValidation.blocked)
  }

  // Step 3: Deterministic hashing check
  const hashingCheck = checkDeterministicHashing(validBundle)
  if (!hashingCheck.stable) {
    warnings.push(...hashingCheck.issues)
  }

  // Build summary
  const actionJobs = validBundle.requests.filter((r) => r.is_action_job)
  const dryRunJobs = validBundle.requests.filter(
    (r) => !r.is_action_job && r.job_type.includes('scan')
  )
  const allScopes = new Set<string>()
  for (const request of validBundle.requests) {
    for (const scope of request.required_scopes) {
      allScopes.add(scope)
    }
  }

  return {
    fixture_name: fixtureName,
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      total_requests: validBundle.requests.length,
      action_jobs: actionJobs.length,
      dry_run_jobs: dryRunJobs.length,
      required_scopes: Array.from(allScopes),
    },
  }
}

// ============================================================================
// Test Runner
// ============================================================================

/**
 * Run contract tests on all fixtures
 */
export async function runContractTests(fixturesDir: string): Promise<ContractTestReport> {
  const results: ContractValidationResult[] = []

  // Try to load fixtures
  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    const files = await fs.readdir(fixturesDir)
    const jsonFiles = files.filter((f) => f.endsWith('.json'))

    for (const file of jsonFiles) {
      const filePath = path.join(fixturesDir, file)
      const content = await fs.readFile(filePath, 'utf-8')
      const fixtureName = path.basename(file, '.json')

      try {
        const bundle = JSON.parse(content)
        results.push(validateContract(fixtureName, bundle))
      } catch (parseError) {
        results.push({
          fixture_name: fixtureName,
          valid: false,
          errors: [
            `JSON parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
          ],
          warnings: [],
          summary: {
            total_requests: 0,
            action_jobs: 0,
            dry_run_jobs: 0,
            required_scopes: [],
          },
        })
      }
    }
  } catch (error) {
    console.error('Failed to load fixtures:', error)
  }

  return {
    passed: results.filter((r) => r.valid).length,
    failed: results.filter((r) => !r.valid).length,
    total: results.length,
    results,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Format test results for CLI output
 */
export function formatContractReport(report: ContractTestReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push('='.repeat(70))
  lines.push('JobForge Contract Test Report')
  lines.push('='.repeat(70))
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Results: ${report.passed}/${report.total} passed, ${report.failed} failed`)
  lines.push('')

  for (const result of report.results) {
    const icon = result.valid ? '✓' : '✗'
    lines.push(`${icon} ${result.fixture_name}`)

    if (result.summary.total_requests > 0) {
      lines.push(`  Requests: ${result.summary.total_requests}`)
      if (result.summary.action_jobs > 0) {
        lines.push(`  Action Jobs: ${result.summary.action_jobs}`)
      }
      lines.push(`  Scopes: ${result.summary.required_scopes.join(', ') || 'none'}`)
    }

    if (result.errors.length > 0) {
      lines.push('  Errors:')
      for (const error of result.errors) {
        lines.push(`    - ${error}`)
      }
    }

    if (result.warnings.length > 0) {
      lines.push('  Warnings:')
      for (const warning of result.warnings) {
        lines.push(`    - ${warning}`)
      }
    }

    lines.push('')
  }

  lines.push('='.repeat(70))
  lines.push(
    report.failed === 0 ? 'All contract tests passed!' : `${report.failed} contract test(s) failed`
  )
  lines.push('='.repeat(70))

  return lines.join('\n')
}
