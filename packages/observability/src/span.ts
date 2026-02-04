/**
 * Observability utilities for request/job boundary spans
 */

import { ObservabilityLogger, LogContext } from './logger'

interface SpanContext extends LogContext {
  trace_id: string
  span_id: string
  parent_span_id?: string
  span_name: string
  started_at: string
}

interface SpanOptions {
  traceId: string
  spanName: string
  parentSpanId?: string
  service: string
  tenantId?: string
  projectId?: string
  actorId?: string
  additionalContext?: LogContext
}

/**
 * Lightweight span for request/job boundaries
 *
 * Tracks timing and context across async operations without
 * external dependencies like OpenTelemetry.
 */
export class ObservabilitySpan {
  private context: SpanContext
  private logger: ObservabilityLogger
  private startTime: number
  private ended: boolean = false

  constructor(options: SpanOptions) {
    this.startTime = performance.now()

    this.context = {
      trace_id: options.traceId,
      span_id: this.generateSpanId(),
      parent_span_id: options.parentSpanId,
      span_name: options.spanName,
      started_at: new Date().toISOString(),
      tenant_id: options.tenantId,
      project_id: options.projectId,
      actor_id: options.actorId,
      ...options.additionalContext,
    }

    this.logger = new ObservabilityLogger({
      service: options.service,
      defaultContext: this.context,
    })

    this.logger.info(`Span started: ${options.spanName}`, {
      event_type: 'span.started',
    })
  }

  /**
   * End the span and log completion
   */
  end(status: 'ok' | 'error' = 'ok', error?: Error): void {
    if (this.ended) {
      return
    }

    this.ended = true
    const durationMs = Math.round(performance.now() - this.startTime)

    const logContext: LogContext = {
      event_type: 'span.ended',
      duration_ms: durationMs,
      span_status: status,
    }

    if (status === 'error' && error) {
      this.logger.logError(`Span failed: ${this.context.span_name}`, error, logContext)
    } else {
      this.logger.info(`Span completed: ${this.context.span_name}`, logContext)
    }
  }

  /**
   * Create a child span
   */
  childSpan(spanName: string, service?: string, additionalContext?: LogContext): ObservabilitySpan {
    return new ObservabilitySpan({
      traceId: this.context.trace_id,
      spanName,
      parentSpanId: this.context.span_id,
      service: service || this.logger['service'],
      tenantId: this.context.tenant_id,
      projectId: this.context.project_id,
      actorId: this.context.actor_id,
      additionalContext: { ...this.context, ...additionalContext },
    })
  }

  /**
   * Get span context for propagation
   */
  getContext(): SpanContext {
    return { ...this.context }
  }

  /**
   * Get the logger for this span
   */
  getLogger(): ObservabilityLogger {
    return this.logger
  }

  /**
   * Execute a function within this span
   */
  async execute<T>(
    fn: (span: ObservabilitySpan) => Promise<T>,
    _errorMessage?: string
  ): Promise<T> {
    try {
      const result = await fn(this)
      this.end('ok')
      return result
    } catch (error) {
      this.end('error', error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }

  /**
   * Generate a simple span ID
   */
  private generateSpanId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 9)}`
  }
}

/**
 * Create and execute a span around an async function
 *
 * @example
 * ```typescript
 * const result = await withSpan(
 *   { traceId: 'uuid', spanName: 'process-contract', service: 'settler' },
 *   async (span) => {
 *     span.getLogger().info('Processing...')
 *     return await processContract(contractId)
 *   }
 * )
 * ```
 */
export async function withSpan<T>(
  options: Omit<SpanOptions, 'parentSpanId'>,
  fn: (span: ObservabilitySpan) => Promise<T>
): Promise<T> {
  const span = new ObservabilitySpan(options)
  return span.execute(fn)
}

/**
 * Create a request boundary span
 *
 * @example
 * ```typescript
 * const span = createRequestSpan({
 *   traceId: extractTraceId(headers),
 *   service: 'settler',
 *   tenantId: 'tenant-uuid',
 *   requestPath: '/api/contracts'
 * })
 *
 * try {
 *   const result = await handler()
 *   span.end('ok')
 *   return result
 * } catch (error) {
 *   span.end('error', error)
 *   throw error
 * }
 * ```
 */
export function createRequestSpan(options: {
  traceId: string
  service: string
  tenantId?: string
  projectId?: string
  actorId?: string
  requestPath: string
  requestMethod?: string
  additionalContext?: LogContext
}): ObservabilitySpan {
  return new ObservabilitySpan({
    traceId: options.traceId,
    spanName: `request:${options.requestMethod || 'GET'} ${options.requestPath}`,
    service: options.service,
    tenantId: options.tenantId,
    projectId: options.projectId,
    actorId: options.actorId,
    additionalContext: {
      request_path: options.requestPath,
      request_method: options.requestMethod,
      ...options.additionalContext,
    },
  })
}

/**
 * Create a job boundary span
 *
 * @example
 * ```typescript
 * const span = createJobSpan({
 *   traceId: job.trace_id,
 *   service: 'jobforge',
 *   jobId: job.id,
 *   jobType: job.type,
 *   tenantId: job.tenant_id
 * })
 *
 * await span.execute(async () => {
 *   return await runHandler(job)
 * })
 * ```
 */
export function createJobSpan(options: {
  traceId: string
  service: string
  jobId: string
  jobType: string
  tenantId?: string
  runId?: string
  additionalContext?: LogContext
}): ObservabilitySpan {
  return new ObservabilitySpan({
    traceId: options.traceId,
    spanName: `job:${options.jobType}`,
    service: options.service,
    tenantId: options.tenantId,
    additionalContext: {
      job_id: options.jobId,
      job_type: options.jobType,
      run_id: options.runId,
      event_type: 'job.started',
      ...options.additionalContext,
    },
  })
}

export type { SpanContext, SpanOptions }
