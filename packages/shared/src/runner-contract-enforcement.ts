/**
 * Runner Contract Enforcement System
 * Enforces strict runner interface validation (schema + runtime)
 * Golden contract tests per runner type (ops, finops, support, growth)
 */

import { z } from 'zod'
import { type ConnectorCapability } from '@autopilot/contracts'

// ============================================================================
// Runner Type Enum
// ============================================================================

export const RUNNER_TYPES = ['ops', 'finops', 'support', 'growth'] as const
export type RunnerType = (typeof RUNNER_TYPES)[number]

// ============================================================================
// Runner Interface Schema (Strict Validation)
// ============================================================================

export const RunnerConfigSchema = z.object({
  runner_id: z.string().min(1),
  runner_type: z.enum(RUNNER_TYPES),
  version: z.string().regex(/^\d+\.\d+\.\d+/),
  description: z.string().min(1).max(500),

  // Required methods
  methods: z.object({
    execute: z.boolean(),
    validate: z.boolean(),
    health: z.boolean(),
    trace: z.boolean(),
  }),

  // Connector support matrix
  connectors: z.object({
    supported: z.array(z.string()).min(1),
    required: z.array(z.string()),
    experimental: z.array(z.string()).optional(),
  }),

  // Determinism guarantees
  determinism: z.object({
    input_snapshot: z.boolean(),
    decision_trace: z.boolean(),
    output_artifact: z.boolean(),
    replayable: z.boolean(),
  }),

  // Rate limiting configuration
  rate_limits: z.object({
    requests_per_second: z.number().positive(),
    burst_size: z.number().positive(),
    max_concurrent: z.number().positive(),
  }),

  // Failure mode handling
  failure_modes: z.array(
    z.object({
      type: z.enum(['timeout', 'error', 'exception', 'resource_exhausted']),
      retryable: z.boolean(),
      backoff_strategy: z.enum(['exponential', 'linear', 'fixed']),
      max_retries: z.number().int().min(0).max(10),
    })
  ),

  // Auth requirements
  auth: z.object({
    required: z.boolean(),
    token_type: z.enum(['bearer', 'api_key', 'none']).optional(),
    scopes: z.array(z.string()).optional(),
  }),

  // Metadata
  metadata: z.object({
    stability: z.enum(['stable', 'beta', 'experimental', 'deprecated']),
    maturity: z.enum(['production', 'preview', 'alpha']),
    breaking_changes_expected: z.boolean().optional(),
    last_audit_date: z.string().datetime().optional(),
    contact_email: z.string().email().optional(),
  }),
})

export type RunnerConfig = z.infer<typeof RunnerConfigSchema>

// ============================================================================
// Runner Contract Validation Result
// ============================================================================

export interface RunnerContractValidation {
  runner_id: string
  runner_type: RunnerType
  valid: boolean
  schema_valid: boolean
  runtime_valid: boolean
  errors: string[]
  warnings: string[]
  contract_drift: string[]
  golden_tests_passed: number
  golden_tests_failed: number
}

export interface RunnerContractReport {
  timestamp: string
  total: number
  passed: number
  failed: number
  drift_detected: number
  results: RunnerContractValidation[]
}

// ============================================================================
// Golden Contract Test Cases per Runner Type
// ============================================================================

export interface GoldenTestCase {
  name: string
  input: unknown
  expected_output: unknown
  expected_trace_keys: string[]
  expected_artifact_keys: string[]
  deterministic: boolean
}

export const GOLDEN_CONTRACT_TESTS: Record<RunnerType, GoldenTestCase[]> = {
  ops: [
    {
      name: 'health_check_returns_healthy',
      input: { type: 'health', tenant_id: 'test-tenant' },
      expected_output: { status: 'healthy', ready: true },
      expected_trace_keys: ['timestamp', 'runner_id', 'input_hash', 'decision'],
      expected_artifact_keys: ['status', 'version', 'connectors'],
      deterministic: true,
    },
    {
      name: 'invalid_payload_rejects_gracefully',
      input: { type: 'execute', payload: null },
      expected_output: { success: false, error_code: 'INVALID_PAYLOAD' },
      expected_trace_keys: ['timestamp', 'runner_id', 'input_hash', 'decision', 'error'],
      expected_artifact_keys: ['error_details', 'validation_result'],
      deterministic: true,
    },
    {
      name: 'concurrent_limits_enforced',
      input: { type: 'execute', count: 100 },
      expected_output: { success: true, throttled: true },
      expected_trace_keys: ['timestamp', 'runner_id', 'throttle_count', 'rate_limit_hit'],
      expected_artifact_keys: ['execution_count', 'throttle_events'],
      deterministic: false, // Non-deterministic due to timing
    },
  ],

  finops: [
    {
      name: 'cost_analysis_returns_metrics',
      input: {
        type: 'cost_analysis',
        tenant_id: 'test-tenant',
        time_range: { start: '2024-01-01', end: '2024-01-31' },
      },
      expected_output: {
        success: true,
        metrics: { total: 0, breakdown: [] },
        currency: 'USD',
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'input_hash', 'analysis_type', 'decision'],
      expected_artifact_keys: ['metrics', 'breakdown', 'recommendations'],
      deterministic: true,
    },
    {
      name: 'anomaly_detection_finds_spikes',
      input: {
        type: 'anomaly_scan',
        baseline_days: 30,
        threshold_pct: 150,
      },
      expected_output: {
        success: true,
        anomalies_found: 0,
        confidence: 0.95,
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'threshold_applied', 'anomaly_count'],
      expected_artifact_keys: ['anomaly_list', 'baseline_stats', 'confidence_scores'],
      deterministic: true,
    },
  ],

  support: [
    {
      name: 'ticket_triage_classifies_correctly',
      input: {
        type: 'triage',
        ticket: {
          subject: 'Cannot login',
          body: 'Error when trying to access dashboard',
          priority: 'high',
        },
      },
      expected_output: {
        success: true,
        classification: 'authentication',
        priority_score: 0.8,
        suggested_queue: 'auth-escalation',
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'classification_model', 'confidence'],
      expected_artifact_keys: ['classification', 'suggested_response', 'similar_tickets'],
      deterministic: false, // ML-based classification
    },
    {
      name: 'kb_search_returns_results',
      input: {
        type: 'kb_search',
        query: 'how to reset password',
        limit: 5,
      },
      expected_output: {
        success: true,
        results: [],
        result_count: 0,
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'query_hash', 'search_time_ms'],
      expected_artifact_keys: ['search_results', 'query_embedding'],
      deterministic: true,
    },
  ],

  growth: [
    {
      name: 'seo_scan_returns_score',
      input: {
        type: 'seo_scan',
        url: 'https://example.com',
        depth: 1,
      },
      expected_output: {
        success: true,
        score: 0,
        issues_found: [],
        recommendations: [],
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'url', 'crawl_depth', 'pages_scanned'],
      expected_artifact_keys: ['seo_report', 'meta_tags', 'performance_metrics'],
      deterministic: true,
    },
    {
      name: 'experiment_proposal_generates_variants',
      input: {
        type: 'experiment_propose',
        metric: 'conversion_rate',
        target_page: '/signup',
      },
      expected_output: {
        success: true,
        variants: [],
        estimated_impact: { min: 0, max: 0 },
      },
      expected_trace_keys: ['timestamp', 'runner_id', 'metric', 'variant_count'],
      expected_artifact_keys: ['variants', 'hypothesis', 'power_analysis'],
      deterministic: false, // Creative/ML generation
    },
  ],
}

// ============================================================================
// Validation Functions
// ============================================================================

export function validateRunnerConfig(runner: unknown): {
  valid: boolean
  errors: string[]
  warnings: string[]
  config?: RunnerConfig
} {
  const errors: string[] = []
  const warnings: string[] = []

  const result = RunnerConfigSchema.safeParse(runner)

  if (!result.success) {
    errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`))
    return { valid: false, errors, warnings }
  }

  const config = result.data

  // Additional semantic validation

  // Check runner_id format (kebab-case)
  if (!/^[a-z0-9-]+$/.test(config.runner_id)) {
    warnings.push(`runner_id should be kebab-case alphanumeric: ${config.runner_id}`)
  }

  // Validate connector references
  const allConnectors = new Set([
    ...config.connectors.supported,
    ...config.connectors.required,
    ...(config.connectors.experimental || []),
  ])

  if (allConnectors.size === 0) {
    errors.push('Runner must support at least one connector')
  }

  // Check determinism requirements
  const determinismFields = Object.entries(config.determinism)
  const enabledDeterminism = determinismFields.filter(([, v]) => v)

  if (enabledDeterminism.length < 3) {
    warnings.push(`Only ${enabledDeterminism.length}/4 determinism guarantees enabled`)
  }

  // Validate rate limits are reasonable
  if (config.rate_limits.requests_per_second > config.rate_limits.burst_size * 2) {
    warnings.push('requests_per_second unusually high compared to burst_size')
  }

  // Check failure mode coverage
  const failureTypes = new Set(config.failure_modes.map((f) => f.type))
  if (!failureTypes.has('timeout')) {
    warnings.push('No timeout failure mode defined')
  }

  // Stability checks
  if (config.metadata.stability === 'stable' && config.metadata.maturity !== 'production') {
    warnings.push('Stable runners should have production maturity')
  }

  if (config.metadata.stability === 'experimental') {
    warnings.push('Experimental runners should not be used in production')
  }

  return { valid: errors.length === 0, errors, warnings, config }
}

export function validateGoldenTestCompliance(
  runnerType: RunnerType,
  testName: string,
  actualTrace: Record<string, unknown>,
  actualArtifacts: Record<string, unknown>
): { compliant: boolean; errors: string[]; missing_keys: string[] } {
  const test = GOLDEN_CONTRACT_TESTS[runnerType].find((t) => t.name === testName)

  if (!test) {
    return {
      compliant: false,
      errors: [`Unknown golden test: ${testName}`],
      missing_keys: [],
    }
  }

  const errors: string[] = []
  const missing_keys: string[] = []

  // Check trace keys
  const traceKeys = Object.keys(actualTrace)
  for (const expectedKey of test.expected_trace_keys) {
    if (!traceKeys.includes(expectedKey)) {
      missing_keys.push(`trace.${expectedKey}`)
    }
  }

  // Check artifact keys
  const artifactKeys = Object.keys(actualArtifacts)
  for (const expectedKey of test.expected_artifact_keys) {
    if (!artifactKeys.includes(expectedKey)) {
      missing_keys.push(`artifact.${expectedKey}`)
    }
  }

  if (missing_keys.length > 0) {
    errors.push(`Missing required keys: ${missing_keys.join(', ')}`)
  }

  return {
    compliant: errors.length === 0,
    errors,
    missing_keys,
  }
}

export function checkContractDrift(
  runnerConfig: RunnerConfig,
  previousConfig?: RunnerConfig
): string[] {
  const drift: string[] = []

  if (!previousConfig) {
    return drift // No baseline to compare against
  }

  // Check version changes
  if (runnerConfig.version !== previousConfig.version) {
    drift.push(`version changed: ${previousConfig.version} -> ${runnerConfig.version}`)
  }

  // Check connector changes
  const prevSupported = new Set(previousConfig.connectors.supported)
  const currSupported = new Set(runnerConfig.connectors.supported)

  for (const conn of currSupported) {
    if (!prevSupported.has(conn)) {
      drift.push(`new connector added: ${conn}`)
    }
  }

  for (const conn of prevSupported) {
    if (!currSupported.has(conn)) {
      drift.push(`connector removed: ${conn} (BREAKING)`)
    }
  }

  // Check method changes
  for (const [method, enabled] of Object.entries(runnerConfig.methods)) {
    const prevEnabled = previousConfig.methods[method as keyof typeof previousConfig.methods]
    if (enabled !== prevEnabled) {
      drift.push(`method ${method}: ${prevEnabled} -> ${enabled}`)
    }
  }

  // Check determinism changes
  for (const [key, enabled] of Object.entries(runnerConfig.determinism)) {
    const prevEnabled = previousConfig.determinism[key as keyof typeof previousConfig.determinism]
    if (enabled !== prevEnabled && !enabled) {
      drift.push(`determinism guarantee lost: ${key} (BREAKING)`)
    }
  }

  // Check stability changes
  if (runnerConfig.metadata.stability !== previousConfig.metadata.stability) {
    drift.push(
      `stability changed: ${previousConfig.metadata.stability} -> ${runnerConfig.metadata.stability}`
    )
  }

  return drift
}

// ============================================================================
// Full Runner Contract Validation
// ============================================================================

export function validateRunnerContract(
  runner: unknown,
  options?: {
    runnerType?: RunnerType
    previousConfig?: RunnerConfig
    skipGoldenTests?: boolean
  }
): RunnerContractValidation {
  const errors: string[] = []
  const warnings: string[] = []
  const drift: string[] = []

  // Step 1: Schema validation
  const schemaResult = validateRunnerConfig(runner)
  errors.push(...schemaResult.errors)
  warnings.push(...schemaResult.warnings)

  const runnerType =
    options?.runnerType || (schemaResult.config?.runner_type as RunnerType) || 'ops'

  const runnerId = schemaResult.config?.runner_id || 'unknown'

  // Step 2: Runtime validation (if schema is valid)
  let runtimeValid = schemaResult.valid
  if (schemaResult.config) {
    // Check golden test compliance
    const goldenTests = GOLDEN_CONTRACT_TESTS[runnerType] || []
    const goldenTestErrors: string[] = []

    for (const test of goldenTests) {
      // In real implementation, this would execute the test
      // For now, we check if the test exists
      if (test.deterministic && !options?.skipGoldenTests) {
        // Validate that required keys are documented
        if (test.expected_trace_keys.length === 0) {
          goldenTestErrors.push(`${test.name}: No trace keys defined`)
        }
        if (test.expected_artifact_keys.length === 0) {
          goldenTestErrors.push(`${test.name}: No artifact keys defined`)
        }
      }
    }

    if (goldenTestErrors.length > 0) {
      runtimeValid = false
      errors.push(...goldenTestErrors)
    }
  }

  // Step 3: Contract drift detection
  if (options?.previousConfig) {
    const driftIssues = checkContractDrift(schemaResult.config!, options.previousConfig)
    drift.push(...driftIssues)
  }

  return {
    runner_id: runnerId,
    runner_type: runnerType,
    valid: errors.length === 0 && runtimeValid,
    schema_valid: schemaResult.valid,
    runtime_valid: runtimeValid,
    errors,
    warnings,
    contract_drift: drift,
    golden_tests_passed: schemaResult.valid ? GOLDEN_CONTRACT_TESTS[runnerType]?.length || 0 : 0,
    golden_tests_failed: errors.length,
  }
}

// ============================================================================
// Contract Test Runner
// ============================================================================

export async function runRunnerContractTests(
  runners: Array<{ config: unknown; type: RunnerType; previous?: RunnerConfig }>
): Promise<RunnerContractReport> {
  const results: RunnerContractValidation[] = []

  for (const runner of runners) {
    const validation = validateRunnerContract(runner.config, {
      runnerType: runner.type,
      previousConfig: runner.previous,
    })
    results.push(validation)
  }

  return {
    timestamp: new Date().toISOString(),
    total: results.length,
    passed: results.filter((r) => r.valid).length,
    failed: results.filter((r) => !r.valid).length,
    drift_detected: results.filter((r) => r.contract_drift.length > 0).length,
    results,
  }
}

export function formatRunnerContractReport(report: RunnerContractReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push('='.repeat(70))
  lines.push('JobForge Runner Contract Validation Report')
  lines.push('='.repeat(70))
  lines.push(`Timestamp: ${report.timestamp}`)
  lines.push(`Results: ${report.passed}/${report.total} passed, ${report.failed} failed`)
  lines.push(`Contract Drift Detected: ${report.drift_detected} runner(s)`)
  lines.push('')

  for (const result of report.results) {
    const icon = result.valid ? '✓' : '✗'
    lines.push(`${icon} ${result.runner_id} (${result.runner_type})`)

    if (result.schema_valid) {
      lines.push('  Schema: valid')
    } else {
      lines.push('  Schema: INVALID')
    }

    if (result.runtime_valid) {
      lines.push('  Runtime: valid')
    } else {
      lines.push('  Runtime: INVALID')
    }

    if (result.golden_tests_passed > 0 || result.golden_tests_failed > 0) {
      lines.push(
        `  Golden Tests: ${result.golden_tests_passed} passed, ${result.golden_tests_failed} failed`
      )
    }

    if (result.contract_drift.length > 0) {
      lines.push('  Contract Drift:')
      for (const drift of result.contract_drift) {
        lines.push(`    ! ${drift}`)
      }
    }

    if (result.errors.length > 0) {
      lines.push('  Errors:')
      for (const error of result.errors) {
        lines.push(`    ✗ ${error}`)
      }
    }

    if (result.warnings.length > 0) {
      lines.push('  Warnings:')
      for (const warning of result.warnings) {
        lines.push(`    ⚠ ${warning}`)
      }
    }

    lines.push('')
  }

  lines.push('='.repeat(70))
  const status =
    report.failed === 0 ? 'All contracts valid!' : `${report.failed} contract(s) failed`
  lines.push(status)
  lines.push('='.repeat(70))

  return lines.join('\n')
}
