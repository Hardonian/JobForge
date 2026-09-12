/**
 * In-memory Mock Client for JobForge SDK
 * Enables unit testing of consumer applications without an external database.
 */

import type {
  JobRow,
  JobResultRow,
  EnqueueJobParams,
  BatchEnqueueJobParams,
  ClaimJobsParams,
  CompleteJobParams,
  CancelJobParams,
  RescheduleJobParams,
  ListJobsParams,
} from '@jobforge/shared'

export class MockJobForgeClient {
  private jobs = new Map<string, JobRow>()
  private results = new Map<string, JobResultRow>()

  async enqueue(params: EnqueueJobParams): Promise<{ job_id: string; status: string }> {
    const jobId = `mock-job-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const job: JobRow = {
      id: jobId,
      tenant_id: params.tenant_id,
      type: params.type,
      payload: params.payload,
      status: 'queued',
      attempts: 0,
      max_attempts: params.max_attempts ?? 5,
      priority: params.priority ?? 0,
      timeout_ms: params.timeout_ms ?? 300000,
      run_at: params.run_at ?? new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      heartbeat_at: null,
      started_at: null,
      finished_at: null,
      idempotency_key: params.idempotency_key ?? null,
      created_by: null,
      error: null,
      result_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    this.jobs.set(jobId, job)
    return { job_id: jobId, status: 'queued' }
  }

  async enqueueBatch(params: BatchEnqueueJobParams): Promise<{ job_ids: string[]; count: number }> {
    const jobIds: string[] = []
    for (const jobParam of params.jobs) {
      const res = await this.enqueue({
        ...jobParam,
        tenant_id: params.tenant_id,
      })
      jobIds.push(res.job_id)
    }
    return { job_ids: jobIds, count: jobIds.length }
  }

  async getJob(id: string): Promise<JobRow | null> {
    return this.jobs.get(id) ?? null
  }

  async listJobs(params: ListJobsParams): Promise<{ jobs: JobRow[]; total: number }> {
    let filtered = Array.from(this.jobs.values()).filter((j) => j.tenant_id === params.tenant_id)
    if (params.filters?.status) {
      const statusFilter = params.filters.status
      if (Array.isArray(statusFilter)) {
        filtered = filtered.filter((j) => statusFilter.includes(j.status))
      } else {
        filtered = filtered.filter((j) => j.status === statusFilter)
      }
    }
    if (params.filters?.type) {
      filtered = filtered.filter((j) => j.type === params.filters?.type)
    }
    const limit = params.filters?.limit ?? 50
    const offset = params.filters?.offset ?? 0
    return {
      jobs: filtered.slice(offset, offset + limit),
      total: filtered.length,
    }
  }

  async claimJobs(params: ClaimJobsParams): Promise<JobRow[]> {
    const claimed: JobRow[] = []
    const limit = params.limit ?? 1
    for (const job of this.jobs.values()) {
      if (job.status === 'queued' && claimed.length < limit) {
        job.status = 'running'
        job.locked_by = params.worker_id
        job.locked_at = new Date().toISOString()
        claimed.push({ ...job })
      }
    }
    return claimed
  }

  async complete(params: CompleteJobParams): Promise<{ success: boolean }> {
    const job = this.jobs.get(params.job_id)
    if (!job) return { success: false }

    job.status = params.status
    job.finished_at = new Date().toISOString()
    if (params.error) {
      job.error = params.error
    }

    if (params.result) {
      const result: JobResultRow = {
        id: `result-${job.id}`,
        job_id: job.id,
        tenant_id: job.tenant_id,
        result: params.result,
        artifact_ref: params.artifact_ref ?? null,
        created_at: new Date().toISOString(),
      }
      this.results.set(job.id, result)
      job.result_id = result.id
    }
    return { success: true }
  }

  async cancel(params: CancelJobParams): Promise<{ success: boolean }> {
    const job = this.jobs.get(params.job_id)
    if (!job) return { success: false }
    job.status = 'canceled'
    return { success: true }
  }

  async reschedule(params: RescheduleJobParams): Promise<{ success: boolean }> {
    const job = this.jobs.get(params.job_id)
    if (!job) return { success: false }
    job.status = 'queued'
    job.run_at = params.run_at
    return { success: true }
  }

  async getResult(jobId: string): Promise<JobResultRow | null> {
    return this.results.get(jobId) ?? null
  }

  reset() {
    this.jobs.clear()
    this.results.clear()
  }
}
