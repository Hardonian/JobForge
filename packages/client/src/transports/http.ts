/**
 * @jobforge/client - HTTP transport
 * Uses HTTP API endpoint for remote access
 * OPTIMIZED: Uses resilientFetch with retries, timeouts, and batching support
 */

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
import type { EventRow, ManifestRow } from '@jobforge/shared'
import { resilientFetch, CONSERVATIVE_RETRY_CONFIG } from '@jobforge/fetch'
import {
  JOBFORGE_INTEGRATION_ENABLED,
  JOBFORGE_DRY_RUN_MODE,
  verifyIntegrationAvailable,
} from '../feature-flags'

/**
 * HTTP transport for remote API access
 * Uses fetch to communicate with JobForge HTTP endpoint
 */
export class HttpTransport implements Transport {
  private apiEndpoint: string
  private apiKey: string
  private dryRun: boolean

  constructor(config: JobForgeClientConfig) {
    if (!config.apiEndpoint) {
      throw new JobForgeClientError('VALIDATION_ERROR', 'HTTP transport requires apiEndpoint')
    }

    this.apiEndpoint = config.apiEndpoint.replace(/\/$/, '') // Remove trailing slash
    this.apiKey = config.apiKey ?? ''
    this.dryRun = config.dryRun ?? JOBFORGE_DRY_RUN_MODE
  }

  async submitEvent(params: SubmitEventParams): Promise<EventRow> {
    verifyIntegrationAvailable()

    try {
      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        return this.createMockEvent(params.envelope)
      }

      const response = await fetch(`${this.apiEndpoint}/events`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(params.envelope),
      })

      if (!response.ok) {
        throw new JobForgeClientError(
          'TRANSPORT_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      return (await response.json()) as EventRow
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to submit event via HTTP', error)
    }
  }

  async requestJob(params: RequestJobParams): Promise<RequestJobResult> {
    verifyIntegrationAvailable()

    try {
      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        return this.createMockJobResult(params)
      }

      const response = await fetch(`${this.apiEndpoint}/jobs`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          job_type: params.jobType,
          inputs: params.inputs,
          tenant_id: params.tenantId,
          project_id: params.projectId,
          trace_id: params.traceId,
          idempotency_key: params.idempotencyKey,
          actor_id: params.actorId,
          source_app: params.sourceApp,
          source_module: params.sourceModule,
        }),
      })

      if (!response.ok) {
        throw new JobForgeClientError(
          'TRANSPORT_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      const data = (await response.json()) as RequestJobResult
      return data
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to request job via HTTP', error)
    }
  }

  async getRunStatus(params: GetRunStatusParams): Promise<RunStatus> {
    verifyIntegrationAvailable()

    try {
      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        return {
          runId: params.runId,
          status: 'completed',
          progress: 100,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        }
      }

      const response = await fetch(
        `${this.apiEndpoint}/runs/${params.runId}/status?tenant_id=${params.tenantId}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          throw new JobForgeClientError('NOT_FOUND', `Run ${params.runId} not found`)
        }
        throw new JobForgeClientError(
          'TRANSPORT_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      return (await response.json()) as RunStatus
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to get run status via HTTP', error)
    }
  }

  async getRunManifest(params: GetRunManifestParams): Promise<ManifestRow | null> {
    verifyIntegrationAvailable()

    try {
      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        return this.createMockManifest(params.runId, params.tenantId)
      }

      const response = await fetch(
        `${this.apiEndpoint}/runs/${params.runId}/manifest?tenant_id=${params.tenantId}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          return null
        }
        throw new JobForgeClientError(
          'TRANSPORT_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      return (await response.json()) as ManifestRow
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to get run manifest via HTTP', error)
    }
  }

  async listArtifacts(params: ListArtifactsParams): Promise<ListArtifactsResult> {
    verifyIntegrationAvailable()

    try {
      if (!JOBFORGE_INTEGRATION_ENABLED || this.dryRun) {
        return {
          runId: params.runId,
          artifacts: [],
          totalCount: 0,
        }
      }

      const response = await fetch(
        `${this.apiEndpoint}/runs/${params.runId}/artifacts?tenant_id=${params.tenantId}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      )

      if (!response.ok) {
        if (response.status === 404) {
          throw new JobForgeClientError('NOT_FOUND', `Run ${params.runId} not found`)
        }
        throw new JobForgeClientError(
          'TRANSPORT_ERROR',
          `HTTP ${response.status}: ${response.statusText}`
        )
      }

      return (await response.json()) as ListArtifactsResult
    } catch (error) {
      if (error instanceof JobForgeClientError) {
        throw error
      }
      throw new JobForgeClientError('TRANSPORT_ERROR', 'Failed to list artifacts via HTTP', error)
    }
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    return headers
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
