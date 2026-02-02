/**
 * @jobforge/client - Main client
 * High-level client for JobForge execution plane
 */

import type {
  JobForgeClientConfig,
  Transport,
  RequestJobResult,
  RunStatus,
  ListArtifactsResult,
  EventEnvelope,
  EventRow,
  ManifestRow,
} from './types'
import { JobForgeClientError } from './types'
import { DirectTransport } from './transports/direct'
import { HttpTransport } from './transports/http'
import {
  JOBFORGE_API_ENDPOINT,
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_DRY_RUN_MODE,
  verifyIntegrationAvailable,
  getFeatureFlagSummary,
} from './feature-flags'

/**
 * JobForge Execution Plane Client
 * Provides a unified interface for submitting events and requesting jobs
 */
export class ExecutionPlaneClient {
  private transport: Transport
  private config: JobForgeClientConfig

  constructor(config?: JobForgeClientConfig) {
    this.config = this.resolveConfig(config)
    this.transport = this.createTransport()
  }

  /**
   * Submit an event envelope to the execution plane
   */
  async submitEvent(envelope: EventEnvelope): Promise<EventRow> {
    return this.transport.submitEvent({ envelope })
  }

  /**
   * Request a job execution
   */
  async requestJob(
    jobType: string,
    inputs: Record<string, unknown>,
    tenantId: string,
    projectId: string | undefined,
    traceId: string,
    idempotencyKey?: string
  ): Promise<RequestJobResult> {
    return this.transport.requestJob({
      jobType,
      inputs,
      tenantId,
      projectId,
      traceId,
      idempotencyKey,
      sourceApp: this.inferSourceApp(),
      dryRun: this.config.dryRun,
    })
  }

  /**
   * Get the status of a run
   */
  async getRunStatus(runId: string, tenantId?: string): Promise<RunStatus> {
    const effectiveTenantId = tenantId ?? this.config.defaultTenantId
    if (!effectiveTenantId) {
      throw new JobForgeClientError(
        'VALIDATION_ERROR',
        'tenantId is required (either in call or default config)'
      )
    }

    return this.transport.getRunStatus({
      runId,
      tenantId: effectiveTenantId,
    })
  }

  /**
   * Get the manifest for a run
   */
  async getRunManifest(runId: string, tenantId?: string): Promise<ManifestRow | null> {
    const effectiveTenantId = tenantId ?? this.config.defaultTenantId
    if (!effectiveTenantId) {
      throw new JobForgeClientError(
        'VALIDATION_ERROR',
        'tenantId is required (either in call or default config)'
      )
    }

    return this.transport.getRunManifest({
      runId,
      tenantId: effectiveTenantId,
    })
  }

  /**
   * List artifacts for a run
   */
  async listArtifacts(runId: string, tenantId?: string): Promise<ListArtifactsResult> {
    const effectiveTenantId = tenantId ?? this.config.defaultTenantId
    if (!effectiveTenantId) {
      throw new JobForgeClientError(
        'VALIDATION_ERROR',
        'tenantId is required (either in call or default config)'
      )
    }

    return this.transport.listArtifacts({
      runId,
      tenantId: effectiveTenantId,
    })
  }

  /**
   * Get feature flag status
   */
  getFeatureFlags(): Record<string, boolean | string> {
    return getFeatureFlagSummary()
  }

  /**
   * Check if integration is enabled
   */
  isEnabled(): boolean {
    return JOBFORGE_INTEGRATION_ENABLED
  }

  /**
   * Check if dry run mode is active
   */
  isDryRun(): boolean {
    return this.config.dryRun ?? JOBFORGE_DRY_RUN_MODE
  }

  private resolveConfig(config?: JobForgeClientConfig): JobForgeClientConfig {
    return {
      supabaseUrl: config?.supabaseUrl ?? process.env.SUPABASE_URL,
      supabaseKey: config?.supabaseKey ?? process.env.SUPABASE_SERVICE_KEY,
      apiEndpoint: config?.apiEndpoint ?? JOBFORGE_API_ENDPOINT,
      apiKey: config?.apiKey ?? process.env.JOBFORGE_API_KEY,
      defaultTenantId: config?.defaultTenantId,
      dryRun: config?.dryRun ?? JOBFORGE_DRY_RUN_MODE,
    }
  }

  private createTransport(): Transport {
    // Prefer HTTP if endpoint is configured, otherwise use direct SDK
    if (this.config.apiEndpoint) {
      return new HttpTransport(this.config)
    }

    return new DirectTransport(this.config)
  }

  private inferSourceApp(): 'settler' | 'aias' | 'keys' | 'readylayer' | 'jobforge' | 'external' {
    // Try to infer from environment or package name
    const pkgName = process.env.npm_package_name ?? ''

    if (pkgName.includes('settler')) return 'settler'
    if (pkgName.includes('aias')) return 'aias'
    if (pkgName.includes('keys')) return 'keys'
    if (pkgName.includes('readylayer')) return 'readylayer'
    if (pkgName.includes('jobforge')) return 'jobforge'

    return 'external'
  }
}

/**
 * Create a new client instance
 */
export function createClient(config?: JobForgeClientConfig): ExecutionPlaneClient {
  return new ExecutionPlaneClient(config)
}

/**
 * Verify that integration is available (throws if not)
 */
export function verifyIntegration(): void {
  verifyIntegrationAvailable()
}
