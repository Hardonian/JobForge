/**
 * Observability Logger
 *
 * Structured JSON logger with consistent fields for cross-service observability.
 * Compatible with local dev and Vercel-like environments.
 */

import { generateCorrelationId } from '@jobforge/errors'
import { OBS_ENABLED } from './feature-flags'
import { redactLogObject, redactHeaders } from './redaction'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogContext {
  trace_id?: string
  tenant_id?: string
  project_id?: string
  actor_id?: string
  event_type?: string
  run_id?: string
  job_id?: string
  job_type?: string
  worker_id?: string
  [key: string]: unknown
}

interface LogEntry extends LogContext {
  timestamp: string
  level: LogLevel
  service: string
  env: string
  message: string
  duration_ms?: number
  error?: {
    code: string
    message: string
    type: string
    correlation_id?: string
  }
}

interface LoggerConfig {
  service: string
  env?: string
  defaultContext?: LogContext
  enableRedaction?: boolean
}

/**
 * Get environment name with fallback chain
 */
function getEnv(): string {
  if (typeof process === 'undefined') {
    return 'local'
  }

  return process.env.ENV || process.env.NODE_ENV || process.env.VERCEL_ENV || 'local'
}

/**
 * Check if we're in a local/development environment
 */
function isLocal(): boolean {
  const env = getEnv()
  return env === 'local' || env === 'development' || env === 'dev'
}

/**
 * Format log entry for output
 */
function formatLogEntry(entry: LogEntry): string {
  if (isLocal() && !OBS_ENABLED) {
    // Pretty print for local development when observability is disabled
    const contextStr = Object.entries(entry)
      .filter(([key]) => !['timestamp', 'level', 'message', 'service', 'env'].includes(key))
      .map(([key, value]) => {
        if (typeof value === 'object') {
          return `${key}=${JSON.stringify(value)}`
        }
        return `${key}=${value}`
      })
      .join(' ')

    return `[${entry.timestamp}] ${entry.level.toUpperCase()} [${entry.service}] ${entry.message} ${contextStr}`
  }

  // JSON format for production and when observability is enabled
  return JSON.stringify(entry)
}

/**
 * Observability Logger
 *
 * Provides structured JSON logging with:
 * - Consistent fields across services
 * - Automatic redaction of sensitive data
 * - Trace correlation
 * - Child logger context propagation
 *
 * @example
 * ```typescript
 * const logger = new ObservabilityLogger({
 *   service: 'settler',
 *   env: process.env.ENV
 * })
 *
 * const requestLogger = logger.child({
 *   trace_id: 'uuid-here',
 *   tenant_id: 'tenant-uuid',
 * })
 *
 * requestLogger.info('Processing contract', {
 *   contract_id: 'uuid',
 *   event_type: 'job.started'
 * })
 * ```
 */
export class ObservabilityLogger {
  private service: string
  private env: string
  private context: LogContext
  private enableRedaction: boolean

  constructor(config: LoggerConfig) {
    this.service = config.service
    this.env = config.env || getEnv()
    this.context = config.defaultContext || {}
    this.enableRedaction = config.enableRedaction !== false
  }

  /**
   * Create a child logger with additional context
   */
  child(context: LogContext): ObservabilityLogger {
    const childLogger = new ObservabilityLogger({
      service: this.service,
      env: this.env,
      defaultContext: { ...this.context, ...context },
      enableRedaction: this.enableRedaction,
    })
    return childLogger
  }

  /**
   * Log at debug level
   */
  debug(message: string, extra?: LogContext): void {
    if (!isLocal() && !OBS_ENABLED) {
      return // Skip debug logs in production unless observability is enabled
    }
    this.log('debug', message, extra)
  }

  /**
   * Log at info level
   */
  info(message: string, extra?: LogContext): void {
    this.log('info', message, extra)
  }

  /**
   * Log at warn level
   */
  warn(message: string, extra?: LogContext): void {
    this.log('warn', message, extra)
  }

  /**
   * Log at error level
   */
  error(message: string, extra?: LogContext): void {
    this.log('error', message, extra)
  }

  /**
   * Log with timing information
   */
  logWithTiming(level: LogLevel, message: string, durationMs: number, extra?: LogContext): void {
    this.log(level, message, { ...extra, duration_ms: durationMs })
  }

  /**
   * Log an error with normalized structure
   */
  logError(message: string, error: Error | unknown, extra?: LogContext): void {
    const normalizedError = this.normalizeError(error)
    this.log('error', message, { ...extra, error: normalizedError })
  }

  /**
   * Internal log method
   */
  private log(level: LogLevel, message: string, extra?: LogContext): void {
    const mergedContext = { ...this.context, ...extra }

    // Redact sensitive data if enabled
    const safeContext = this.enableRedaction ? redactLogObject(mergedContext) : mergedContext

    // Extract standard fields
    const {
      trace_id,
      tenant_id,
      project_id,
      actor_id,
      event_type,
      run_id,
      job_id,
      job_type,
      worker_id,
      duration_ms,
      error,
      ...otherFields
    } = safeContext

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      env: this.env,
      message,
      trace_id: trace_id as string | undefined,
      tenant_id: tenant_id as string | undefined,
      project_id: project_id as string | undefined,
      actor_id: actor_id as string | undefined,
      event_type: event_type as string | undefined,
      run_id: run_id as string | undefined,
      job_id: job_id as string | undefined,
      job_type: job_type as string | undefined,
      worker_id: worker_id as string | undefined,
      duration_ms: duration_ms as number | undefined,
      error: error as LogEntry['error'] | undefined,
      ...otherFields,
    }

    // Remove undefined fields for cleaner output
    const cleanEntry = Object.fromEntries(
      Object.entries(entry).filter(([_, v]) => v !== undefined)
    ) as LogEntry

    const output = formatLogEntry(cleanEntry)

    // Write to appropriate stream
    if (level === 'error') {
      console.error(output)
    } else if (level === 'warn') {
      console.warn(output)
    } else {
      console.log(output)
    }
  }

  /**
   * Normalize error for safe logging
   */
  private normalizeError(error: Error | unknown): LogEntry['error'] {
    const correlationId = generateCorrelationId()

    if (error instanceof Error) {
      return {
        code: this.inferErrorCode(error),
        message: this.sanitizeErrorMessage(error.message),
        type: error.constructor.name,
        correlation_id: correlationId,
      }
    }

    return {
      code: 'UNKNOWN_ERROR',
      message: this.sanitizeErrorMessage(String(error)),
      type: 'Unknown',
      correlation_id: correlationId,
    }
  }

  /**
   * Infer error code from error type/message
   */
  private inferErrorCode(error: Error): string {
    const name = error.constructor.name.toLowerCase()
    const message = error.message.toLowerCase()

    if (
      name.includes('validation') ||
      message.includes('validation') ||
      message.includes('invalid')
    ) {
      return 'VALIDATION_ERROR'
    }
    if (
      name.includes('notfound') ||
      message.includes('not found') ||
      message.includes('notfound')
    ) {
      return 'NOT_FOUND'
    }
    if (
      name.includes('unauthorized') ||
      message.includes('unauthorized') ||
      message.includes('auth')
    ) {
      return 'UNAUTHORIZED'
    }
    if (
      name.includes('forbidden') ||
      message.includes('forbidden') ||
      message.includes('permission')
    ) {
      return 'FORBIDDEN'
    }
    if (name.includes('timeout') || message.includes('timeout')) {
      return 'TIMEOUT_ERROR'
    }
    if (name.includes('network') || message.includes('network') || message.includes('connection')) {
      return 'EXTERNAL_SERVICE_ERROR'
    }

    return 'INTERNAL_ERROR'
  }

  /**
   * Sanitize error message to remove potential secrets
   */
  private sanitizeErrorMessage(message: string): string {
    // Truncate long messages
    const maxLength = 500
    let sanitized = message.length > maxLength ? message.substring(0, maxLength) + '...' : message

    // Basic secret patterns
    const secretPatterns = [
      /Bearer\s+\S+/gi,
      /token[=:]\s*\S+/gi,
      /api[_-]?key[=:]\s*\S+/gi,
      /secret[=:]\s*\S+/gi,
      /password[=:]\s*\S+/gi,
    ]

    for (const pattern of secretPatterns) {
      sanitized = sanitized.replace(pattern, '[REDACTED]')
    }

    return sanitized
  }

  /**
   * Get current logger context (for testing)
   */
  getContext(): LogContext {
    return { ...this.context }
  }
}

/**
 * Create a logger instance
 */
export function createLogger(
  service: string,
  defaultContext?: LogContext,
  enableRedaction?: boolean
): ObservabilityLogger {
  return new ObservabilityLogger({
    service,
    env: getEnv(),
    defaultContext,
    enableRedaction,
  })
}

/**
 * Create a request-scoped logger with trace context
 */
export function createRequestLogger(
  service: string,
  traceId: string,
  tenantId?: string,
  actorId?: string
): ObservabilityLogger {
  return createLogger(service, {
    trace_id: traceId,
    tenant_id: tenantId,
    actor_id: actorId,
  })
}

export type { LogContext, LogEntry, LogLevel, LoggerConfig }
export { redactLogObject, redactHeaders }
