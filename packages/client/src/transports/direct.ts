/**
 * @jobforge/client - Direct transport
 * Uses @jobforge/sdk-ts directly for monorepo imports
 */

import { JobForgeClient as SdkClient } from '@jobforge/sdk-ts'
import type {
  SubmitEventParams,
  RequestJobParams,
  RequestJobResult,
  GetRunStatusParams,
  RunStatus,
  GetRunManifestParams,
  ListArtifactsParams,
  ListArtifactsResult,
  Transport,
  JobForgeClientConfig,
} from '../types'
import { JobForgeClientError } from '../types'
import {
  submitEventParamsSchema,
  requestJobParamsSchema,
  getRunStatusParamsSchema,
  getRunManifestParamsSchema,
  listArtifactsParamsSchema,
} from '../schemas'
import {
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_DRY_RUN_MODE,
  verifyIntegrationAvailable,
} from '../feature-flags'
import type { EventRow, ManifestRow } from '@jobforge/shared'

/**
 * Direct transport using @jobforge/sdk-ts
 * For use within the same monorepo
 */
export class DirectTransport implements Transport {
  private sdkClient: SdkClient
  private dryRun: boolean

  constructor(config: JobForgeClientConfig) {
    this.dryRun = config.dryRun ?? JOBFORGE_DRY_RUN_MODE

    // Only require credentials if not in dry-run mode
    if (!this.dryRun && (!config.supabaseUrl || !config.supabaseKey)) {
      throw new JobForgeClientError(
        'VALIDATION_ERROR',
        'Direct transport requires supabaseUrl and supabaseKey'
      )
    }

    // Create SDK client only if we have credentials
    if (config.supabaseUrl && config.supabaseKey) {
      this.sdkClient = new SdkClient({
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      })
    } else {
      // Create a mock client for dry-run mode
      this.sdkClient = {} as SdkClient
    }
  }

  async submitEvent(params: SubmitEventParams): Promise<EventRow> {
    verifyIntegrationAvailable()

    try {
      const validated = submitEventParamsSchema.parse(params)

      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        // Return mock event in dry run mode
        return this.createMockEvent(validated.envelope)
      }

      const { envelope } = validated
      return await this.sdkClient.submitEvent({
        tenant_id: envelope.tenant_id,
        event_type: envelope.event_type,
        trace_id: envelope.trace_id,
        source_app: envelope.source_app,
        payload: envelope.payload,
        project_id: envelope.project_id,
        actor_id: envelope.actor_id,
        source_module: envelope.source_module,
        subject_type: envelope.subject?.type,
        subject_id: envelope.subject?.id,
        contains_pii: envelope.contains_pii,
        redaction_hints: envelope.redaction_hints,
        event_version: envelope.event_version,
      })
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to submit event', error)
    }
  }

  async requestJob(params: RequestJobParams): Promise<RequestJobResult> {
    verifyIntegrationAvailable()

    try {
      const validated = requestJobParamsSchema.parse(params)

      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        // Return mock result in dry run mode
        return this.createMockJobResult(validated)
      }

      const result = await this.sdkClient.requestJob({
        tenant_id: validated.tenantId,
        template_key: validated.jobType,
        inputs: validated.inputs,
        project_id: validated.projectId,
        trace_id: validated.traceId,
        actor_id: validated.actorId,
        dry_run: this.dryRun,
      })

      return {
        runId: result.job.id as string,
        status: 'queued',
        traceId: result.trace_id,
        dryRun: result.dry_run ?? this.dryRun,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to request job', error)
    }
  }

  async getRunStatus(params: GetRunStatusParams): Promise<RunStatus> {
    verifyIntegrationAvailable()

    try {
      const validated = getRunStatusParamsSchema.parse(params)

      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        // Return mock status in dry run mode
        return {
          runId: validated.runId,
          status: 'completed',
          progress: 100,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }
      }

      const job = await this.sdkClient.getJob(validated.runId, validated.tenantId)

      if (!job) {
        throw new JobForgeClientError('NOT_FOUND', `Run ${validated.runId} not found`)
      }

      return {
        runId: job.id,
        status: this.mapJobStatus(job.status),
        startedAt: job.started_at ?? undefined,
        completedAt: job.finished_at ?? undefined,
      }
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to get run status', error)
    }
  }

  async getRunManifest(params: GetRunManifestParams): Promise<ManifestRow | null> {
    verifyIntegrationAvailable()

    try {
      const validated = getRunManifestParamsSchema.parse(params)

      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        // Return mock manifest in dry run mode
        return this.createMockManifest(validated.runId, validated.tenantId)
      }

      return await this.sdkClient.getRunManifest({
        run_id: validated.runId,
        tenant_id: validated.tenantId,
      })
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to get run manifest', error)
    }
  }

  async listArtifacts(params: ListArtifactsParams): Promise<ListArtifactsResult> {
    verifyIntegrationAvailable()

    try {
      const validated = listArtifactsParamsSchema.parse(params)

      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        // Return mock artifacts in dry run mode
        return {
          runId: validated.runId,
          artifacts: [],
          totalCount: 0,
        }
      }

      const artifacts = await this.sdkClient.listArtifacts(validated.runId, validated.tenantId)

      return {
        runId: validated.runId,
        artifacts,
        totalCount: artifacts.length,
      }
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to list artifacts', error)
    }
  }

  private mapJobStatus(
    status: string
  ): 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' {
    switch (status) {
      case 'pending':
        return 'pending'
      case 'running':
        return 'running'
      case 'completed':
      case 'succeeded':
        return 'completed'
      case 'failed':
        return 'failed'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'pending'
    }
  }

  private createMockEvent(envelope: SubmitEventParams['envelope']): EventRow {
    return {
      id: `mock-${Date.now()}`,
      tenant_id: envelope.tenant_id,
      project_id: envelope.project_id ?? null,
      event_version: envelope.event_version,
      event_type: envelope.event_type,
      occurred_at: envelope.occurred_at,
      trace_id: envelope.trace_id,
      actor_id: envelope.actor_id ?? null,
      source_app: envelope.source_app,
      source_module: envelope.source_module ?? null,
      subject_type: envelope.subject?.type ?? null,
      subject_id: envelope.subject?.id ?? null,
      payload: envelope.payload,
      contains_pii: envelope.contains_pii,
      redaction_hints: envelope.redaction_hints ?? null,
      processed: false,
      processed_at: null,
      processing_job_id: null,
      created_at: new Date().toISOString(),
    }
  }

  private createMockJobResult(params: RequestJobParams): RequestJobResult {
    return {
      runId: `mock-run-${Date.now()}`,
      status: 'queued',
      traceId: params.traceId,
      dryRun: true,
      timestamp: new Date().toISOString(),
    }
  }

  private createMockManifest(runId: string, tenantId: string): ManifestRow {
    return {
      id: `mock-manifest-${Date.now()}`,
      run_id: runId,
      tenant_id: tenantId,
      project_id: null,
      manifest_version: '1.0',
      job_type: 'mock-job',
      created_at: new Date().toISOString(),
      inputs_snapshot_ref: null,
      logs_ref: null,
      outputs: [],
      metrics: {},
      env_fingerprint: {},
      tool_versions: {},
      status: 'complete',
      error: null,
    }
  }
}
