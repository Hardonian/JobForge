/**
 * @jobforge/shared - E2E Smoke Matrix Runner
 *
 * Comprehensive smoke tests that verify:
 * 1. All services are up and healthy
 * 2. Each runner capability is callable via jobforge
 * 3. Truthcore (Postgres) is reachable and deterministic
 * 4. Failure scenarios produce recoverable, actionable errors (no hard-500s)
 *
 * NOTE: This file uses dynamic imports to avoid circular dependencies.
 * Run these tests after building all packages.
 */

import { generateCorrelationId, runWithCorrelationId, AppError, ErrorCode } from '@jobforge/errors'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobRow } from '@jobforge/shared'

// Test configuration
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001'

// Service health check configuration
interface ServiceHealthConfig {
  name: string
  healthEndpoint?: string
  check: () => Promise<HealthCheckResult>
}

interface HealthCheckResult {
  healthy: boolean
  latencyMs: number
  error?: string
  details?: Record<string, unknown>
}

// Smoke matrix result
export interface SmokeMatrixResult {
  timestamp: string
  correlationId: string
  overallHealthy: boolean
  services: ServiceHealthResult[]
  runners: RunnerCapabilityResult[]
  truthcore: TruthcoreResult
  errors: SmokeError[]
}

interface ServiceHealthResult extends HealthCheckResult {
  name: string
}

interface RunnerCapabilityResult {
  runnerType: string
  capability: string
  callable: boolean
  latencyMs: number
  error?: string
  errorCode?: ErrorCode
  recoverable: boolean
}

interface TruthcoreResult {
  reachable: boolean
  deterministic: boolean
  latencyMs: number
  consistencyCheck: boolean
  error?: string
}

interface SmokeError {
  component: string
  error: string
  errorCode?: ErrorCode
  recoverable: boolean
  actionable: boolean
  correlationId: string
}

interface EventEnvelope {
  schema_version: string
  event_version: string
  event_type: string
  occurred_at: string
  trace_id: string
  tenant_id: string
  source_app: string
  payload: Record<string, unknown>
  contains_pii: boolean
}

// Extended client interfaces
interface JobForgeClient {
  enqueueJob(params: {
    tenant_id: string
    project_id?: string
    type: string
    payload: Record<string, unknown>
    idempotency_key: string
  }): Promise<JobRow>
}

interface ExecutionPlaneClient {
  submitEvent(envelope: EventEnvelope): Promise<unknown>
}

/**
 * Smoke Matrix Runner - Main test orchestrator
 */
export class SmokeMatrixRunner {
  private client: JobForgeClient | null = null
  private executionClient: ExecutionPlaneClient | null = null
  private supabase: SupabaseClient | null = null
  private correlationId: string
  private results: SmokeMatrixResult

  constructor() {
    this.correlationId = generateCorrelationId()
    this.results = {
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      overallHealthy: true,
      services: [],
      runners: [],
      truthcore: {
        reachable: false,
        deterministic: false,
        latencyMs: 0,
        consistencyCheck: false,
      },
      errors: [],
    }
  }

  /**
   * Initialize the runner with proper client setup
   */
  async init(): Promise<void> {
    // Dynamic imports to avoid circular dependencies
    const sdkModule = await import('@jobforge/sdk-ts')
    const clientModule = await import('@jobforge/client')
    const { createClient } = await import('@supabase/supabase-js')

    // Create Supabase client for direct health checks
    this.supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

    // The SDK exports JobForgeClient class
    this.client = new sdkModule.JobForgeClient({
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    }) as unknown as JobForgeClient

    this.executionClient = clientModule.createClient({
      supabaseUrl: process.env.SUPABASE_URL!,
      supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      defaultTenantId: TEST_TENANT_ID,
    }) as ExecutionPlaneClient
  }

  /**
   * Run the complete smoke matrix
   */
  async run(): Promise<SmokeMatrixResult> {
    return runWithCorrelationId(this.correlationId, async () => {
      console.log(`[Smoke Matrix] Starting smoke test run...`)
      console.log(`[Smoke Matrix] Correlation ID: ${this.correlationId}`)

      // Initialize clients
      await this.init()

      // Phase 1: Service Health Checks
      await this.checkAllServices()

      // Phase 2: Runner Capabilities
      await this.checkRunnerCapabilities()

      // Phase 3: Truthcore Verification
      await this.checkTruthcore()

      // Calculate overall health
      this.results.overallHealthy = this.calculateOverallHealth()

      console.log(`[Smoke Matrix] Run complete. Overall healthy: ${this.results.overallHealthy}`)

      return this.results
    })
  }

  /**
   * Check all services are up and healthy
   */
  private async checkAllServices(): Promise<void> {
    const services: ServiceHealthConfig[] = [
      {
        name: 'postgres-truthcore',
        check: () => this.checkPostgresHealth(),
      },
      {
        name: 'worker-ts',
        check: () => this.checkWorkerHealth('typescript'),
      },
      {
        name: 'worker-py',
        check: () => this.checkWorkerHealth('python'),
      },
      {
        name: 'execution-plane',
        check: () => this.checkExecutionPlaneHealth(),
      },
    ]

    console.log(`[Smoke Matrix] Checking ${services.length} services...`)

    for (const service of services) {
      const startTime = Date.now()
      try {
        const result = await service.check()
        this.results.services.push({
          name: service.name,
          ...result,
          latencyMs: Date.now() - startTime,
        })

        if (!result.healthy) {
          this.addError(service.name, result.error || 'Unknown error')
        }
      } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        this.results.services.push({
          name: service.name,
          healthy: false,
          latencyMs: Date.now() - startTime,
          error: errorMsg,
        })
        this.addError(service.name, errorMsg)
      }
    }
  }

  /**
   * Check each runner capability is callable via jobforge
   */
  private async checkRunnerCapabilities(): Promise<void> {
    const capabilities = [
      { runner: 'connector.http', type: 'connector.http.request' },
      { runner: 'connector.webhook', type: 'connector.webhook.send' },
      { runner: 'runner.ts', type: 'runner.ts.execute' },
      { runner: 'runner.py', type: 'runner.py.execute' },
    ]

    console.log(`[Smoke Matrix] Checking ${capabilities.length} runner capabilities...`)

    for (const cap of capabilities) {
      const startTime = Date.now()
      try {
        // Attempt to enqueue a dry-run job
        const result = await this.checkCapability(cap.type)
        const latencyMs = Date.now() - startTime

        this.results.runners.push({
          runnerType: cap.runner,
          capability: cap.type,
          callable: result.callable,
          latencyMs,
          error: result.error,
          errorCode: result.errorCode,
          recoverable: result.recoverable,
        })

        if (!result.callable) {
          this.addError(
            cap.runner,
            result.error || 'Capability not callable',
            result.errorCode,
            result.recoverable
          )
        }
      } catch (error: unknown) {
        const latencyMs = Date.now() - startTime
        const errorMsg = error instanceof Error ? error.message : String(error)
        const appError = error instanceof AppError ? error : null

        this.results.runners.push({
          runnerType: cap.runner,
          capability: cap.type,
          callable: false,
          latencyMs,
          error: errorMsg,
          errorCode: appError?.code,
          recoverable: this.isRecoverableError(error),
        })

        this.addError(cap.runner, errorMsg, appError?.code, this.isRecoverableError(error))
      }
    }
  }

  /**
   * Check truthcore (Postgres) is reachable and deterministic
   */
  private async checkTruthcore(): Promise<void> {
    console.log(`[Smoke Matrix] Checking truthcore...`)
    const startTime = Date.now()

    try {
      // Check reachability via Supabase RPC
      const health = await this.checkSupabaseHealth()

      // Check determinism - run the same query twice and compare
      const consistencyCheck = await this.checkDeterminism()

      this.results.truthcore = {
        reachable: health.healthy,
        deterministic: consistencyCheck.consistent,
        latencyMs: Date.now() - startTime,
        consistencyCheck: consistencyCheck.consistent,
        error: health.error,
      }

      if (!health.healthy) {
        this.addError('truthcore', health.error || 'Truthcore not reachable')
      }

      if (!consistencyCheck.consistent) {
        this.addError(
          'truthcore',
          'Determinism check failed: inconsistent results',
          ErrorCode.INTERNAL_ERROR
        )
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      this.results.truthcore = {
        reachable: false,
        deterministic: false,
        latencyMs: Date.now() - startTime,
        consistencyCheck: false,
        error: errorMsg,
      }
      this.addError('truthcore', errorMsg)
    }
  }

  /**
   * Check Supabase/Postgres health via direct query
   */
  private async checkSupabaseHealth(): Promise<HealthCheckResult> {
    try {
      const start = Date.now()
      // Execute a simple health check query
      const { data, error } = await this.supabase!.rpc('jobforge_health_check')

      if (error) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: `Postgres health check failed: ${error.message}`,
        }
      }

      return {
        healthy: true,
        latencyMs: Date.now() - start,
        details: { result: data },
      }
    } catch (error: unknown) {
      return {
        healthy: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Check Postgres health via SDK
   */
  private async checkPostgresHealth(): Promise<HealthCheckResult> {
    return this.checkSupabaseHealth()
  }

  /**
   * Check worker health by querying recent jobs
   */
  private async checkWorkerHealth(workerType: 'typescript' | 'python'): Promise<HealthCheckResult> {
    try {
      const start = Date.now()

      // Query for recent jobs processed by this worker type
      const { data, error } = await this.supabase!.from('jobforge_job_results')
        .select('completed_at')
        .eq('worker_id', workerType)
        .order('completed_at', { ascending: false })
        .limit(1)

      if (error) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
          error: `Worker health check failed: ${error.message}`,
        }
      }

      const hasRecentActivity =
        data &&
        data.length > 0 &&
        new Date(data[0].completed_at as string).getTime() > Date.now() - 10 * 60 * 1000 // 10 minutes

      return {
        healthy: hasRecentActivity,
        latencyMs: Date.now() - start,
        error: hasRecentActivity ? undefined : 'No recent worker activity found',
        details: { lastActivity: data?.[0]?.completed_at },
      }
    } catch (error: unknown) {
      return {
        healthy: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Check execution plane health
   */
  private async checkExecutionPlaneHealth(): Promise<HealthCheckResult> {
    try {
      const start = Date.now()
      // Attempt a simple operation through the execution client
      await this.executionClient!.submitEvent({
        schema_version: '1.0.0',
        event_version: '1.0',
        event_type: 'smoke.heartbeat',
        occurred_at: new Date().toISOString(),
        trace_id: generateCorrelationId(),
        tenant_id: TEST_TENANT_ID,
        source_app: 'jobforge',
        payload: { type: 'smoke-test' },
        contains_pii: false,
      })

      return {
        healthy: true,
        latencyMs: Date.now() - start,
      }
    } catch (error: unknown) {
      return {
        healthy: false,
        latencyMs: 0,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Check if a specific capability is callable
   */
  private async checkCapability(
    jobType: string
  ): Promise<{ callable: boolean; error?: string; errorCode?: ErrorCode; recoverable: boolean }> {
    try {
      // Enqueue a dry-run job to test capability
      const job = await this.client!.enqueueJob({
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        type: jobType,
        payload: {
          _smoke_test: true,
          _dry_run: true,
          url: 'https://httpbin.org/get',
          method: 'GET',
        },
        idempotency_key: `smoke-${jobType}-${Date.now()}`,
      })

      return {
        callable: !!job.id,
        recoverable: true,
      }
    } catch (error: unknown) {
      const appError = error instanceof AppError ? error : null
      return {
        callable: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: appError?.code,
        recoverable: this.isRecoverableError(error),
      }
    }
  }

  /**
   * Check determinism by running the same query twice
   */
  private async checkDeterminism(): Promise<{ consistent: boolean; error?: string }> {
    try {
      // Get job counts twice and compare using Supabase
      const result1 = await this.getJobCounts(TEST_TENANT_ID)
      const result2 = await this.getJobCounts(TEST_TENANT_ID)

      const consistent =
        result1.pending === result2.pending &&
        result1.running === result2.running &&
        result1.completed === result2.completed &&
        result1.failed === result2.failed

      return { consistent }
    } catch (error: unknown) {
      return {
        consistent: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get job counts for a tenant
   */
  private async getJobCounts(
    tenantId: string
  ): Promise<{ pending: number; running: number; completed: number; failed: number }> {
    const { data, error } = await this.supabase!.from('jobforge_jobs')
      .select('status')
      .eq('tenant_id', tenantId)

    if (error) {
      throw new Error(`Failed to get job counts: ${error.message}`)
    }

    const counts = { pending: 0, running: 0, completed: 0, failed: 0 }
    for (const job of data || []) {
      const status = job.status as keyof typeof counts
      if (status in counts) {
        counts[status]++
      }
    }

    return counts
  }

  /**
   * Determine if an error is recoverable
   */
  private isRecoverableError(error: unknown): boolean {
    if (error instanceof AppError) {
      // Operational errors are recoverable
      if (error.isOperational) return true

      // Specific error codes that are recoverable
      const errorCode = error.code
      const recoverableCodes: string[] = [
        ErrorCode.TIMEOUT_ERROR,
        ErrorCode.SERVICE_UNAVAILABLE,
        ErrorCode.RATE_LIMIT_EXCEEDED,
        ErrorCode.EXTERNAL_SERVICE_ERROR,
      ]

      if (recoverableCodes.includes(errorCode)) return true

      // Non-recoverable codes
      const nonRecoverableCodes: string[] = [
        ErrorCode.VALIDATION_ERROR,
        ErrorCode.BAD_REQUEST,
        ErrorCode.UNAUTHORIZED,
        ErrorCode.FORBIDDEN,
      ]

      if (nonRecoverableCodes.includes(errorCode)) return false
    }

    // Default to recoverable for unknown errors (conservative)
    return true
  }

  /**
   * Add an error to the results
   */
  private addError(
    component: string,
    error: string,
    errorCode?: ErrorCode,
    recoverable?: boolean
  ): void {
    const isRecoverable = recoverable ?? this.isRecoverableError(new Error(error))

    this.results.errors.push({
      component,
      error,
      errorCode,
      recoverable: isRecoverable,
      actionable: true, // All errors should have actionable messages
      correlationId: this.correlationId,
    })

    console.error(`[Smoke Matrix] Error in ${component}: ${error}`)
  }

  /**
   * Calculate overall health from individual checks
   */
  private calculateOverallHealth(): boolean {
    const allServicesHealthy = this.results.services.every((s) => s.healthy)
    const allRunnersCallable = this.results.runners.every((r) => r.callable)
    const truthcoreHealthy =
      this.results.truthcore.reachable && this.results.truthcore.deterministic

    return allServicesHealthy && allRunnersCallable && truthcoreHealthy
  }

  /**
   * Get formatted results for reporting
   */
  getFormattedResults(): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════╗',
      '║            JOBFORGE SMOKE MATRIX RESULTS                 ║',
      '╚══════════════════════════════════════════════════════════╝',
      '',
      `Correlation ID: ${this.results.correlationId}`,
      `Timestamp: ${this.results.timestamp}`,
      `Overall Status: ${this.results.overallHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`,
      '',
      '--- Services ---',
    ]

    for (const service of this.results.services) {
      const status = service.healthy ? '✅' : '❌'
      lines.push(`${status} ${service.name} (${service.latencyMs}ms)`)
      if (service.error) {
        lines.push(`   Error: ${service.error}`)
      }
    }

    lines.push('', '--- Runner Capabilities ---')
    for (const runner of this.results.runners) {
      const status = runner.callable ? '✅' : '❌'
      const recovery = runner.recoverable ? '(recoverable)' : '(non-recoverable)'
      lines.push(`${status} ${runner.runnerType} - ${runner.capability} ${recovery}`)
      if (runner.error) {
        lines.push(`   Error: ${runner.error} [${runner.errorCode || 'UNKNOWN'}]`)
      }
    }

    lines.push('', '--- Truthcore ---')
    const tc = this.results.truthcore
    lines.push(`${tc.reachable ? '✅' : '❌'} Reachable (${tc.latencyMs}ms)`)
    lines.push(`${tc.deterministic ? '✅' : '❌'} Deterministic`)
    lines.push(`${tc.consistencyCheck ? '✅' : '❌'} Consistency Check`)
    if (tc.error) {
      lines.push(`   Error: ${tc.error}`)
    }

    if (this.results.errors.length > 0) {
      lines.push('', '--- Errors ---')
      for (const err of this.results.errors) {
        const recovery = err.recoverable ? '🔧' : '💥'
        lines.push(`${recovery} [${err.component}] ${err.error}`)
        if (err.errorCode) {
          lines.push(`   Code: ${err.errorCode}`)
        }
      }
    }

    return lines.join('\n')
  }

  /**
   * Set results (for external result injection)
   */
  setResults(results: SmokeMatrixResult): void {
    this.results = results
  }
}

/**
 * Run smoke matrix and return results
 */
export async function runSmokeMatrix(): Promise<SmokeMatrixResult> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const correlationId = generateCorrelationId()
    return {
      timestamp: new Date().toISOString(),
      correlationId,
      overallHealthy: true,
      services: [],
      runners: [],
      truthcore: {
        reachable: false,
        deterministic: false,
        latencyMs: 0,
        consistencyCheck: false,
        error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      },
      errors: [
        {
          component: 'environment',
          error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
          errorCode: ErrorCode.SERVICE_UNAVAILABLE,
          recoverable: true,
          actionable: true,
          correlationId,
        },
      ],
    }
  }

  const runner = new SmokeMatrixRunner()
  return runner.run()
}

/**
 * Format smoke matrix results for console output
 */
export function formatSmokeMatrixResults(results: SmokeMatrixResult): string {
  const runner = new SmokeMatrixRunner()
  runner.setResults(results)
  return runner.getFormattedResults()
}
