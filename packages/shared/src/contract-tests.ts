/**
 * JobForge Contract Test Harness
 * Validates runnerless module outputs against @autopilot/contracts
 */

import { z } from 'zod'
import {
  JobRequestBundleSchema,
  type JobRequestBundle,
  canonicalizeJson,
  hashCanonicalJson,
  SCHEMA_VERSION,
  ConnectorCapabilitySchema,
  ErrorEnvelopeSchema,
} from '@autopilot/contracts'

// ============================================================================
// Contract Validation Types
// ============================================================================

export interface ContractValidationResult {
  fixture_name: string
  valid: boolean
  actual_valid: boolean
  expected_valid: boolean
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
  schema_version: z.literal(SCHEMA_VERSION),
  bundle_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  project_id: z.string().uuid().optional(),
  trace_id: z.string().min(1),
  requests: z.array(z.any()).min(1).max(100),
  metadata: z
    .object({
      source: z.string(),
      triggered_at: z.string().datetime(),
      correlation_id: z.string().optional(),
    })
    .passthrough(),
})

const stableIdPattern = /^[a-z0-9-]+$/
const MAX_PAYLOAD_BYTES = 64 * 1024

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

  if (!validBundle.project_id) {
    errors.push('Bundle missing required field: project_id')
  }

  // Tenant/project consistency validation
  const tenantIds = new Set<string>([validBundle.tenant_id])
  const projectIds = new Set<string | undefined>([validBundle.project_id])

  for (const request of validBundle.requests) {
    tenantIds.add(request.tenant_id)
    projectIds.add(request.project_id)
    if (!request.project_id) {
      errors.push(`Request missing required field project_id: ${request.id}`)
    }
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

    const payloadSize = Buffer.byteLength(JSON.stringify(request.payload), 'utf8')
    if (payloadSize > MAX_PAYLOAD_BYTES) {
      errors.push(
        `Payload too large for request ${request.id}: ${payloadSize} bytes (max ${MAX_PAYLOAD_BYTES})`
      )
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
  canonicalizeJson(bundle)

  // Check for common non-deterministic patterns
  const jsonStr = canonicalizeJson(bundle)

  // Check for timestamps that might vary
  if (jsonStr.includes('Date.now()') || jsonStr.includes('new Date()')) {
    issues.push('Bundle contains dynamic timestamp generation')
  }

  // Check for random values
  if (jsonStr.includes('Math.random()') || jsonStr.includes('randomUUID()')) {
    issues.push('Bundle contains random value generation')
  }

  // Generate deterministic hash (twice to ensure stability)
  const firstHash = hashCanonicalJson(bundle)
  const secondHash = hashCanonicalJson(bundle)

  if (firstHash !== secondHash) {
    issues.push('Canonical hash mismatch between runs')
  }

  return {
    stable: issues.length === 0,
    issues,
    hash: firstHash,
  }
}

/**
 * Executor preflight validation
 */
export function runExecutorPreflight(bundle: JobRequestBundle): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []
  const executorValidation = simulateExecutorValidation(bundle, {
    policyTokenPresent: true,
    requiredTenantId: bundle.tenant_id,
    requiredProjectId: bundle.project_id,
  })

  if (!executorValidation.valid) {
    errors.push(...executorValidation.errors)
  }

  if (executorValidation.blocked.length > 0) {
    errors.push(
      ...executorValidation.blocked.map((entry) => `Executor preflight blocked: ${entry}`)
    )
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Full contract validation of a fixture
 */
export function validateContract(
  fixtureName: string,
  bundle: unknown,
  expectedValid = true
): ContractValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // Step 1: Bundle validation
  const bundleValidation = validateBundle(bundle)
  errors.push(...bundleValidation.errors)

  if (!bundleValidation.valid) {
    const actualValid = false
    return {
      fixture_name: fixtureName,
      valid: actualValid === expectedValid,
      actual_valid: actualValid,
      expected_valid: expectedValid,
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

  // Step 1b: Schema version support check
  if (validBundle.schema_version !== SCHEMA_VERSION) {
    errors.push(`Unsupported schema_version: ${validBundle.schema_version}`)
  }

  // Step 2: Executor simulation
  const executorValidation = simulateExecutorValidation(validBundle)
  if (!executorValidation.valid) {
    errors.push(...executorValidation.errors)
  }
  if (executorValidation.blocked.length > 0) {
    warnings.push(...executorValidation.blocked)
  }

  // Step 3: Executor preflight
  const executorPreflight = runExecutorPreflight(validBundle)
  if (!executorPreflight.valid) {
    errors.push(...executorPreflight.errors)
  }

  // Step 4: Deterministic hashing check
  const hashingCheck = checkDeterministicHashing(validBundle)
  if (!hashingCheck.stable) {
    errors.push(...hashingCheck.issues)
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

  const actualValid = errors.length === 0

  return {
    fixture_name: fixtureName,
    valid: actualValid === expectedValid,
    actual_valid: actualValid,
    expected_valid: expectedValid,
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
export async function runContractTests(
  fixturesDir: string | string[]
): Promise<ContractTestReport> {
  const results: ContractValidationResult[] = []
  const fixtureDirs = Array.isArray(fixturesDir) ? fixturesDir : [fixturesDir]

  // Try to load fixtures
  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    const collectJsonFiles = async (dirPath: string): Promise<string[]> => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      const files: string[] = []

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (entry.name === 'manifests') {
            continue
          }
          const nested = await collectJsonFiles(path.join(dirPath, entry.name))
          files.push(...nested)
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          files.push(path.join(dirPath, entry.name))
        }
      }

      return files
    }

    for (const dirPath of fixtureDirs) {
      try {
        const dirStat = await fs.stat(dirPath)
        if (!dirStat.isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      const jsonFiles = await collectJsonFiles(dirPath)

      for (const filePath of jsonFiles) {
        const content = await fs.readFile(filePath, 'utf-8')
        const baseName = path.basename(filePath, '.json')
        const expectedValid = !baseName.startsWith('invalid-')
        const fixtureName = path.relative(dirPath, filePath).replace(/\\/g, '/')

        try {
          const bundle = JSON.parse(content)
          results.push(validateContract(fixtureName, bundle, expectedValid))
        } catch (parseError) {
          results.push({
            fixture_name: fixtureName,
            valid: false,
            actual_valid: false,
            expected_valid: expectedValid,
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
    lines.push(
      `${icon} ${result.fixture_name} (expected ${result.expected_valid ? 'valid' : 'invalid'})`
    )

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

// ============================================================================
// Connector Schema Validation
// ============================================================================

/**
 * Validate a connector definition against the canonical schema
 */
export function validateConnectorSchema(connector: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const result = ConnectorCapabilitySchema.safeParse(connector)
  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
  }

  // Additional semantic validation
  if (result.success) {
    const validConnector = result.data

    // Validate version format (semver-like)
    if (!/^\d+\.\d+\.\d+/.test(validConnector.version)) {
      errors.push('version should follow semantic versioning (e.g., 1.0.0)')
    }

    // Check for duplicate job types
    const jobTypes = new Set<string>()
    for (const jobType of validConnector.supported_job_types) {
      if (jobTypes.has(jobType)) {
        errors.push(`Duplicate supported_job_type: ${jobType}`)
      }
      jobTypes.add(jobType)
    }
  }

  return { valid: errors.length === 0, errors }
}

// Re-export validateRunnerCapabilities from registry-handshake
export { validateRunnerCapabilities } from './registry-handshake.js'

// ============================================================================
// Error Envelope Validation
// ============================================================================

/**
 * Validate an error envelope against the canonical schema
 */
export function validateErrorEnvelope(error: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  const result = ErrorEnvelopeSchema.safeParse(error)
  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
    return { valid: false, errors }
  }

  const validError = result.data

  // Validate timestamp is in the past (or very near future for clock skew)
  const errorTime = new Date(validError.timestamp).getTime()
  const now = Date.now()
  const fiveMinutesMs = 5 * 60 * 1000

  if (errorTime > now + fiveMinutesMs) {
    errors.push('timestamp is more than 5 minutes in the future (possible clock skew)')
  }

  // Validate that details is structured properly when it's an array
  if (Array.isArray(validError.details)) {
    for (let i = 0; i < validError.details.length; i++) {
      const detail = validError.details[i]
      if (!detail.field || typeof detail.field !== 'string') {
        errors.push(`details[${i}]: field is required and must be a string`)
      }
      if (!detail.message || typeof detail.message !== 'string') {
        errors.push(`details[${i}]: message is required and must be a string`)
      }
    }
  }

  return { valid: errors.length === 0, errors }
}
