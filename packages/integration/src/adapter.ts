/**
 * JobForge Base Adapter
 *
 * All four apps (Settler, ReadyLayer, Keys, AIAS) extend this base class
 * to integrate with the JobForge execution plane.
 */

import { JobForgeClient } from '@jobforge/sdk-ts'
import type {
  SubmitEventParams,
  RequestJobParams,
  RequestJobResult,
  GetManifestParams,
  ManifestRow,
  SourceApp,
  SourceModule,
  EventRow,
} from '@jobforge/sdk-ts'
import {
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_INTEGRATION_DRY_RUN,
  isIntegrationEnabled,
  getTenantMapping,
  getProjectMapping,
  getIntegrationConfig,
} from './feature-flags'
import {
  TraceContext,
  createTraceContext,
  generateTraceId,
  extractTraceFromHeaders,
  createTraceHeaders,
} from './trace'

/**
 * Adapter configuration
 */
export interface JobForgeAdapterConfig {
  /** App identifier - 'settler' | 'readylayer' | 'keys' | 'aias' */
  app: SourceApp
  /** Tenant ID (or use env mapping) */
  tenantId?: string
  /** Project ID (or use env mapping) */
  projectId?: string
  /** Custom Supabase client */
  client?: JobForgeClient
}

/**
 * Event submission options
 */
export interface SubmitEventOptions {
  eventType: string
  payload?: Record<string, unknown>
  traceId?: string
  actorId?: string
  module?: SourceModule
  containsPii?: boolean
  subjectType?: string
  subjectId?: string
}

/**
 * Job request options
 */
export interface RequestJobOptions {
  templateKey: string
  inputs?: Record<string, unknown>
  traceId?: string
  actorId?: string
  dryRun?: boolean
}

/**
 * Job status result
 */
export interface JobStatusResult {
  status: 'pending' | 'complete' | 'failed' | 'unknown'
  manifest?: ManifestRow
  error?: string
}

/**
 * Base JobForge Adapter
 *
 * Provides:
 * - submitEvent(envelope) - Submit events to execution plane
 * - requestJob(job_type,...) - Request autopilot jobs
 * - getRunManifest/runStatus - Check job status
 * - Trace ID propagation across HTTP/jobs/tools
 * - Feature flag safety (disabled by default)
 */
export class JobForgeAdapter {
  protected client: JobForgeClient | null = null
  protected config: JobForgeAdapterConfig
  protected enabled: boolean = false
  protected tenantId: string
  protected projectId: string | undefined

  constructor(config: JobForgeAdapterConfig) {
    this.config = config

    // Check if integration is enabled
    this.enabled = isIntegrationEnabled(config.app)

    // Resolve tenant/project from config or env mapping
    this.tenantId = config.tenantId || getTenantMapping(config.app) || ''
    this.projectId = config.projectId || getProjectMapping(config.app)

    // Initialize client if enabled and credentials available
    if (this.enabled) {
      this.initializeClient(config.client)
    }
  }

  /**
   * Initialize the JobForge client
   */
  private initializeClient(existingClient?: JobForgeClient): void {
    if (existingClient) {
      this.client = existingClient
      return
    }

    const { supabaseUrl, supabaseKey } = getIntegrationConfig()

    if (!supabaseUrl || !supabaseKey) {
      console.warn(
        `[JobForge:${this.config.app}] Integration enabled but missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`
      )
      this.enabled = false
      return
    }

    this.client = new JobForgeClient({
      supabaseUrl,
      supabaseKey,
    })
  }

  /**
   * Check if adapter is enabled and ready
   */
  isEnabled(): boolean {
    return this.enabled && this.client !== null
  }

  /**
   * Get adapter configuration (for debugging)
   */
  getConfig(): {
    enabled: boolean
    app: SourceApp
    tenantId: string
    projectId: string | undefined
    dryRunDefault: boolean
  } {
    return {
      enabled: this.enabled,
      app: this.config.app,
      tenantId: this.tenantId,
      projectId: this.projectId,
      dryRunDefault: JOBFORGE_INTEGRATION_DRY_RUN,
    }
  }

  /**
   * Submit an event to the execution plane
   * Requires JOBFORGE_INTEGRATION_ENABLED=1 and JOBFORGE_EVENTS_ENABLED=1
   */
  async submitEvent(options: SubmitEventOptions): Promise<EventRow | null> {
    if (!this.isEnabled()) {
      console.log(`[JobForge:${this.config.app}] submitEvent skipped (disabled)`)
      return null
    }

    if (!this.client) {
      throw new Error('JobForge client not initialized')
    }

    const traceId = options.traceId || generateTraceId()

    const params: SubmitEventParams = {
      tenant_id: this.tenantId,
      event_type: options.eventType,
      trace_id: traceId,
      source_app: this.config.app,
      payload: options.payload || {},
      actor_id: options.actorId,
      source_module: options.module,
      subject_type: options.subjectType,
      subject_id: options.subjectId,
      contains_pii: options.containsPii || false,
    }

    try {
      const event = await this.client.submitEvent(params)
      console.log(`[JobForge:${this.config.app}] Event submitted: ${event.id}`)
      return event
    } catch (error) {
      console.error(`[JobForge:${this.config.app}] Failed to submit event:`, error)
      throw error
    }
  }

  /**
   * Request an autopilot job
   * Requires JOBFORGE_INTEGRATION_ENABLED=1 and JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
   */
  async requestJob(options: RequestJobOptions): Promise<RequestJobResult | null> {
    if (!this.isEnabled()) {
      console.log(`[JobForge:${this.config.app}] requestJob skipped (disabled)`)
      return null
    }

    if (!this.client) {
      throw new Error('JobForge client not initialized')
    }

    const traceId = options.traceId || generateTraceId()
    const dryRun = options.dryRun ?? JOBFORGE_INTEGRATION_DRY_RUN

    const params: RequestJobParams = {
      tenant_id: this.tenantId,
      template_key: options.templateKey,
      inputs: options.inputs || {},
      project_id: this.projectId,
      trace_id: traceId,
      actor_id: options.actorId,
      dry_run: dryRun,
    }

    try {
      const result = await this.client.requestJob(params)
      console.log(
        `[JobForge:${this.config.app}] Job requested: ${result.job?.id || 'dry-run'}${dryRun ? ' (dry-run)' : ''}`
      )
      return result
    } catch (error) {
      console.error(`[JobForge:${this.config.app}] Failed to request job:`, error)
      throw error
    }
  }

  /**
   * Get run manifest for a job
   * Requires JOBFORGE_INTEGRATION_ENABLED=1 and JOBFORGE_MANIFESTS_ENABLED=1
   */
  async getRunManifest(runId: string): Promise<ManifestRow | null> {
    if (!this.isEnabled()) {
      console.log(`[JobForge:${this.config.app}] getRunManifest skipped (disabled)`)
      return null
    }

    if (!this.client) {
      throw new Error('JobForge client not initialized')
    }

    const params: GetManifestParams = {
      run_id: runId,
      tenant_id: this.tenantId,
    }

    try {
      const manifest = await this.client.getRunManifest(params)
      return manifest
    } catch (error) {
      console.error(`[JobForge:${this.config.app}] Failed to get manifest:`, error)
      throw error
    }
  }

  /**
   * Check job status and get manifest if complete
   */
  async getRunStatus(runId: string): Promise<JobStatusResult> {
    if (!this.isEnabled()) {
      return { status: 'unknown' }
    }

    try {
      const manifest = await this.getRunManifest(runId)

      if (!manifest) {
        return { status: 'pending' }
      }

      return {
        status:
          manifest.status === 'complete'
            ? 'complete'
            : manifest.status === 'failed'
              ? 'failed'
              : 'pending',
        manifest,
      }
    } catch (error) {
      return {
        status: 'unknown',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Create trace context for HTTP request
   * Use this at the start of request handlers
   */
  createTraceContext(actorId?: string): TraceContext {
    return createTraceContext(this.tenantId, this.config.app, this.projectId, actorId)
  }

  /**
   * Extract trace from incoming HTTP headers
   * Returns trace ID if present, undefined otherwise
   */
  extractTraceFromHeaders(
    headers: Record<string, string | string[] | undefined>
  ): string | undefined {
    return extractTraceFromHeaders(headers)
  }

  /**
   * Create HTTP headers with trace for outgoing requests
   */
  createTraceHeaders(traceId: string): Record<string, string> {
    return createTraceHeaders(traceId)
  }

  /**
   * Generate a new trace ID
   */
  generateTraceId(): string {
    return generateTraceId()
  }
}

/**
 * Create a JobForge adapter instance
 * Convenience factory function
 */
export function createJobForgeAdapter(
  app: SourceApp,
  tenantId?: string,
  projectId?: string,
  client?: JobForgeClient
): JobForgeAdapter {
  return new JobForgeAdapter({
    app,
    tenantId,
    projectId,
    client,
  })
}
