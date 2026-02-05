/**
 * JobForge TypeScript Worker
 */

import { JobForgeClient } from '@jobforge/sdk-ts'
import type { JobRow, JobContext } from '@jobforge/shared'
import { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_POLL_INTERVAL_MS } from '@jobforge/shared'
import { HandlerRegistry } from './registry'
import { logger, type Logger } from './logger'
import { randomUUID } from 'crypto'
import { calculateNextPollInterval } from './polling'
import { calculateNextHeartbeatInterval } from './heartbeat'

type JobForgeClientLike = Pick<JobForgeClient, 'claimJobs' | 'heartbeatJob' | 'completeJob'>

export interface WorkerConfig {
  workerId: string
  supabaseUrl: string
  supabaseKey: string
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  claimLimit?: number
  maxPollIntervalMs?: number
  idleBackoffMultiplier?: number
  heartbeatMaxIntervalMs?: number
  heartbeatBackoffMultiplier?: number
  client?: JobForgeClientLike
}

export class Worker {
  private client: JobForgeClientLike
  private registry: HandlerRegistry
  private config: Required<Omit<WorkerConfig, 'client'>>
  private logger: Logger
  private running = false
  private shuttingDown = false
  private activeJobs = new Set<string>()
  private heartbeatTimeouts = new Map<string, NodeJS.Timeout>()
  private heartbeatIntervals = new Map<string, number>()

  constructor(config: WorkerConfig, registry: HandlerRegistry) {
    const basePollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const maxPollIntervalMs = Math.max(
      config.maxPollIntervalMs ?? basePollIntervalMs,
      basePollIntervalMs
    )
    const idleBackoffMultiplier = Math.max(config.idleBackoffMultiplier ?? 2, 1)
    const baseHeartbeatIntervalMs =
      config.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS
    const maxHeartbeatIntervalMs = Math.max(
      config.heartbeatMaxIntervalMs ?? baseHeartbeatIntervalMs * 2,
      baseHeartbeatIntervalMs
    )
    const heartbeatBackoffMultiplier = Math.max(config.heartbeatBackoffMultiplier ?? 2, 1)
    const {
      client: injectedClient,
      maxPollIntervalMs: _maxPollIntervalMs,
      idleBackoffMultiplier: _idleBackoffMultiplier,
      heartbeatMaxIntervalMs: _heartbeatMaxIntervalMs,
      heartbeatBackoffMultiplier: _heartbeatBackoffMultiplier,
      ...configWithoutClient
    } = config

    this.config = {
      pollIntervalMs: basePollIntervalMs,
      heartbeatIntervalMs: baseHeartbeatIntervalMs,
      claimLimit: 10,
      maxPollIntervalMs,
      idleBackoffMultiplier,
      heartbeatMaxIntervalMs,
      heartbeatBackoffMultiplier,
      ...configWithoutClient,
    }

    this.client =
      injectedClient ||
      new JobForgeClient({
        supabaseUrl: config.supabaseUrl,
        supabaseKey: config.supabaseKey,
      })

    this.registry = registry
    this.logger = logger.child({ worker_id: this.config.workerId })
  }

  /**
   * Run worker once (claim and process available jobs)
   */
  async runOnce(): Promise<number> {
    try {
      const jobs = await this.client.claimJobs({
        worker_id: this.config.workerId,
        limit: this.config.claimLimit,
      })

      if (jobs.length === 0) {
        this.logger.debug('No jobs claimed')
        return 0
      }

      this.logger.info(`Claimed ${jobs.length} jobs`)

      // Process jobs concurrently
      await Promise.allSettled(jobs.map((job) => this.processJob(job)))
      return jobs.length
    } catch (error) {
      this.logger.error('Error in runOnce', {
        error: error instanceof Error ? error.message : String(error),
      })
      return 0
    }
  }

  /**
   * Run worker in loop
   */
  async run(): Promise<void> {
    this.running = true
    this.logger.info('Worker started', {
      poll_interval_ms: this.config.pollIntervalMs,
      claim_limit: this.config.claimLimit,
      max_poll_interval_ms: this.config.maxPollIntervalMs,
      idle_backoff_multiplier: this.config.idleBackoffMultiplier,
      heartbeat_interval_ms: this.config.heartbeatIntervalMs,
      heartbeat_max_interval_ms: this.config.heartbeatMaxIntervalMs,
      heartbeat_backoff_multiplier: this.config.heartbeatBackoffMultiplier,
    })

    this.setupShutdownHandlers()

    let currentIntervalMs = this.config.pollIntervalMs

    while (this.running && !this.shuttingDown) {
      const jobsClaimed = await this.runOnce()

      if (!this.shuttingDown) {
        const nextIntervalMs = calculateNextPollInterval({
          currentIntervalMs,
          baseIntervalMs: this.config.pollIntervalMs,
          maxIntervalMs: this.config.maxPollIntervalMs,
          idleBackoffMultiplier: this.config.idleBackoffMultiplier,
          jobsClaimed,
        })

        if (nextIntervalMs !== currentIntervalMs) {
          this.logger.debug('Adjusted poll interval', {
            previous_interval_ms: currentIntervalMs,
            next_interval_ms: nextIntervalMs,
            jobs_claimed: jobsClaimed,
          })
        }

        currentIntervalMs = nextIntervalMs
        await this.sleep(currentIntervalMs)
      }
    }

    await this.shutdown()
  }

  /**
   * Process a single job
   */
  private async processJob(job: JobRow): Promise<void> {
    const trace_id = randomUUID()
    const jobLogger = this.logger.child({
      trace_id,
      job_id: job.id,
      job_type: job.type,
      tenant_id: job.tenant_id,
      attempt_no: job.attempts,
    })

    this.activeJobs.add(job.id)
    jobLogger.info('Processing job started')

    // Setup heartbeat
    this.startHeartbeat(job, jobLogger)

    try {
      const registration = this.registry.get(job.type)

      if (!registration) {
        throw new Error(`No handler registered for job type: ${job.type}`)
      }

      // Validate payload if validator provided
      if (registration.options?.validate) {
        const isValid = registration.options.validate(job.payload)
        if (!isValid) {
          throw new Error('Payload validation failed')
        }
      }

      // Create job context
      const context: JobContext = {
        job_id: job.id,
        tenant_id: job.tenant_id,
        attempt_no: job.attempts,
        trace_id,
        heartbeat: async () => {
          await this.client.heartbeatJob({
            job_id: job.id,
            worker_id: this.config.workerId,
          })
        },
      }

      // Execute handler with timeout
      const timeoutMs = registration.options?.timeoutMs || 300_000 // 5 min default
      const result = await this.withTimeout(registration.handler(job.payload, context), timeoutMs)

      // Complete job successfully
      await this.client.completeJob({
        job_id: job.id,
        worker_id: this.config.workerId,
        status: 'succeeded',
        result: result as Record<string, unknown>,
      })

      jobLogger.info('Job succeeded')
    } catch (error) {
      const errorObj = error instanceof Error ? error : new Error(String(error))
      const errorData = {
        message: errorObj.message,
        stack: errorObj.stack,
        name: errorObj.name,
      }

      jobLogger.error('Job failed', { error: errorObj.message })

      await this.client.completeJob({
        job_id: job.id,
        worker_id: this.config.workerId,
        status: 'failed',
        error: errorData,
      })
    } finally {
      // Clean up heartbeat
      this.clearHeartbeat(job.id)

      this.activeJobs.delete(job.id)
    }
  }

  /**
   * Graceful shutdown
   */
  private async shutdown(): Promise<void> {
    this.logger.info('Worker shutting down gracefully', {
      active_jobs: this.activeJobs.size,
    })

    // Wait for active jobs to complete (with timeout)
    const shutdownTimeout = 30_000 // 30 seconds
    const start = Date.now()

    while (this.activeJobs.size > 0 && Date.now() - start < shutdownTimeout) {
      await this.sleep(1000)
    }

    // Clear all heartbeat intervals
    for (const timeout of this.heartbeatTimeouts.values()) {
      clearTimeout(timeout)
    }
    this.heartbeatTimeouts.clear()
    this.heartbeatIntervals.clear()

    this.logger.info('Worker stopped', {
      remaining_jobs: this.activeJobs.size,
    })
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupShutdownHandlers(): void {
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM']

    for (const signal of signals) {
      process.on(signal, () => {
        if (!this.shuttingDown) {
          this.logger.info(`Received ${signal}, shutting down...`)
          this.shuttingDown = true
          this.running = false
        }
      })
    }
  }

  /**
   * Helper: sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private startHeartbeat(job: JobRow, jobLogger: Logger): void {
    const baseIntervalMs = this.config.heartbeatIntervalMs
    const maxIntervalMs = this.config.heartbeatMaxIntervalMs
    const backoffMultiplier = this.config.heartbeatBackoffMultiplier
    let currentIntervalMs = baseIntervalMs

    const schedule = (): void => {
      if (this.shuttingDown || !this.activeJobs.has(job.id)) {
        return
      }

      const timeout = setTimeout(async () => {
        try {
          await this.client.heartbeatJob({
            job_id: job.id,
            worker_id: this.config.workerId,
          })
        } catch (error) {
          jobLogger.warn('Heartbeat failed', {
            error: error instanceof Error ? error.message : String(error),
          })
        }

        currentIntervalMs = calculateNextHeartbeatInterval({
          currentIntervalMs,
          baseIntervalMs,
          maxIntervalMs,
          backoffMultiplier,
        })
        this.heartbeatIntervals.set(job.id, currentIntervalMs)
        schedule()
      }, currentIntervalMs)

      this.heartbeatTimeouts.set(job.id, timeout)
      this.heartbeatIntervals.set(job.id, currentIntervalMs)
    }

    schedule()
  }

  private clearHeartbeat(jobId: string): void {
    const timeout = this.heartbeatTimeouts.get(jobId)
    if (timeout) {
      clearTimeout(timeout)
      this.heartbeatTimeouts.delete(jobId)
    }
    this.heartbeatIntervals.delete(jobId)
  }

  /**
   * Helper: run with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Handler timeout')), timeoutMs)
      ),
    ])
  }
}
