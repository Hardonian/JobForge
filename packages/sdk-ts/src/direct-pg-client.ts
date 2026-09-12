/**
 * JobForge Universal Direct PostgreSQL Client
 * Enables running JobForge against vanilla PostgreSQL (AWS RDS, Aurora, Cloud SQL, Azure, Neon, Bare Metal)
 * via direct SQL wire protocol without requiring Supabase PostgREST.
 */

import type {
  JobRow,
  EnqueueJobParams,
  ClaimJobsParams,
  CompleteJobParams,
  HeartbeatJobParams,
  CancelJobParams,
  ListJobsParams,
} from '@jobforge/shared'
import {
  enqueueJobParamsSchema,
  completeJobParamsSchema,
  compressPayload,
  decompressPayload,
} from '@jobforge/shared'

export interface QueryResult<T = unknown> {
  rows: T[]
  rowCount?: number
}

export type SqlQueryFunction = <T = unknown>(
  sql: string,
  params?: unknown[]
) => Promise<QueryResult<T> | T[]>

export interface DirectPgClientConfig {
  /**
   * Pluggable SQL execution function.
   * Compatible with pg.Pool.query, postgres.js, Neon serverless, Prisma $queryRawUnsafe, etc.
   */
  executor: SqlQueryFunction
}

export class DirectPgJobForgeClient {
  private query: (sql: string, params?: unknown[]) => Promise<unknown[]>

  constructor(config: DirectPgClientConfig) {
    this.query = async (sql: string, params?: unknown[]) => {
      const result = await config.executor(sql, params)
      if (Array.isArray(result)) {
        return result
      }
      if (result && typeof result === 'object' && 'rows' in result && Array.isArray(result.rows)) {
        return result.rows
      }
      return []
    }
  }

  /**
   * Enqueue a new job directly into PostgreSQL with automatic payload compression
   */
  async enqueueJob(params: EnqueueJobParams): Promise<JobRow> {
    const validated = enqueueJobParamsSchema.parse(params)
    const compressed = compressPayload(validated.payload)

    const sql = `
      INSERT INTO jobforge_jobs (
        tenant_id, type, payload, priority, timeout_ms, idempotency_key, run_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()))
      ON CONFLICT (tenant_id, type, idempotency_key) WHERE idempotency_key IS NOT NULL
      DO UPDATE SET updated_at = NOW()
      RETURNING *;
    `

    const rows = (await this.query(sql, [
      validated.tenant_id,
      validated.type,
      JSON.stringify(compressed),
      validated.priority ?? 0,
      validated.timeout_ms ?? 300000,
      validated.idempotency_key ?? null,
      validated.run_at ?? null,
    ])) as JobRow[]

    if (!rows[0]) {
      throw new Error('Failed to enqueue job: database did not return created row')
    }

    const row = rows[0]
    return {
      ...row,
      payload: decompressPayload(row.payload) as Record<string, unknown>,
    }
  }

  /**
   * Claim jobs with priority using atomic row-level locking
   */
  async claimJobs(params: ClaimJobsParams): Promise<JobRow[]> {
    const sql = `SELECT * FROM claim_jobs_with_priority($1, $2);`
    const rows = (await this.query(sql, [params.worker_id, params.limit ?? 10])) as JobRow[]

    return rows.map((row) => ({
      ...row,
      payload: decompressPayload(row.payload) as Record<string, unknown>,
    }))
  }

  /**
   * Fair-share claim RPC interleaving across tenants for noisy neighbor mitigation
   */
  async claimJobsFairShare(
    workerId: string,
    limit: number = 10,
    tenantLimit: number = 2
  ): Promise<JobRow[]> {
    const sql = `SELECT * FROM claim_jobs_fair_share($1, $2, $3);`
    const rows = (await this.query(sql, [workerId, limit, tenantLimit])) as JobRow[]

    return rows.map((row) => ({
      ...row,
      payload: decompressPayload(row.payload) as Record<string, unknown>,
    }))
  }

  /**
   * Record worker heartbeat
   */
  async heartbeatJob(params: HeartbeatJobParams): Promise<void> {
    const sql = `
      UPDATE jobforge_jobs
      SET heartbeat_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND locked_by = $2 AND status = 'running';
    `
    await this.query(sql, [params.job_id, params.worker_id])
  }

  /**
   * Complete a job (succeeded or failed)
   */
  async completeJob(params: CompleteJobParams): Promise<void> {
    const validated = completeJobParamsSchema.parse(params)

    const sql = `
      SELECT complete_job(
        $1::uuid,
        $2::text,
        $3::text,
        $4::jsonb,
        $5::jsonb
      );
    `
    await this.query(sql, [
      validated.job_id,
      validated.worker_id,
      validated.status,
      validated.result ? JSON.stringify(validated.result) : null,
      validated.error ? JSON.stringify(validated.error) : null,
    ])
  }

  /**
   * Cancel an enqueued or running job
   */
  async cancelJob(params: CancelJobParams): Promise<JobRow> {
    const sql = `
      UPDATE jobforge_jobs
      SET status = 'canceled', finished_at = NOW(), updated_at = NOW()
      WHERE id = $1
      RETURNING *;
    `
    const rows = (await this.query(sql, [params.job_id])) as JobRow[]
    if (!rows[0]) {
      throw new Error(`Job not found or could not be canceled: ${params.job_id}`)
    }
    return rows[0]
  }

  /**
   * List jobs with tenant filtering
   */
  async listJobs(params: ListJobsParams): Promise<JobRow[]> {
    let sql = `SELECT * FROM jobforge_jobs WHERE tenant_id = $1`
    const queryParams: unknown[] = [params.tenant_id]

    if (params.filters?.status) {
      queryParams.push(params.filters.status)
      sql += ` AND status = $${queryParams.length}`
    }

    if (params.filters?.type) {
      queryParams.push(params.filters.type)
      sql += ` AND type = $${queryParams.length}`
    }

    sql += ` ORDER BY created_at DESC LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2};`
    queryParams.push(params.filters?.limit ?? 50, params.filters?.offset ?? 0)

    const rows = (await this.query(sql, queryParams)) as JobRow[]
    return rows.map((r) => ({
      ...r,
      payload: decompressPayload(r.payload) as Record<string, unknown>,
    }))
  }

  /**
   * Retrieve FinOps billing and compute metrics for a tenant
   */
  async getTenantBillingMetrics(
    tenantId: string,
    startDate?: string,
    endDate?: string
  ): Promise<
    Array<{
      period_date: string
      jobs_completed: number
      jobs_failed: number
      compute_ms: number
      ingress_bytes: number
      egress_bytes: number
      estimated_cost_usd: number
    }>
  > {
    const sql = `SELECT * FROM get_tenant_billing_metrics($1, COALESCE($2, CURRENT_DATE - INTERVAL '30 days'), COALESCE($3, CURRENT_DATE));`
    return (await this.query(sql, [tenantId, startDate ?? null, endDate ?? null])) as Array<{
      period_date: string
      jobs_completed: number
      jobs_failed: number
      compute_ms: number
      ingress_bytes: number
      egress_bytes: number
      estimated_cost_usd: number
    }>
  }
}
