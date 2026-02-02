/**
 * @jobforge/observability - Observability layer for JobForge
 *
 * Provides structured logging, trace correlation, log redaction,
 * and error normalization across all JobForge-integrated services.
 *
 * @example
 * ```typescript
 * import {
 *   ObservabilityLogger,
 *   redactLogObject,
 *   withSpan,
 *   normalizeError
 * } from '@jobforge/observability'
 *
 * const logger = new ObservabilityLogger({ service: 'settler' })
 *
 * await withSpan(
 *   { traceId: 'uuid', spanName: 'process-contract', service: 'settler' },
 *   async (span) => {
 *     span.getLogger().info('Processing...')
 *     return await processContract()
 *   }
 * )
 * ```
 */

// Logger
export { ObservabilityLogger, createLogger, createRequestLogger } from './logger'
export type { LogContext, LogEntry, LogLevel, LoggerConfig } from './logger'

// Redaction
export {
  redactLogObject,
  redactHeaders,
  redactUrl,
  createRedactor,
  DEFAULT_REDACTION_PATTERNS,
  REDACTION_MARKERS,
} from './redaction'

// Spans
export { ObservabilitySpan, withSpan, createRequestSpan, createJobSpan } from './span'
export type { SpanContext, SpanOptions } from './span'

// Error normalization
export {
  normalizeError,
  sanitizeErrorMessage,
  createNormalizedError,
  withNormalizedErrors,
  ErrorCodes,
} from './errors'
export type { NormalizedError, ErrorCode } from './errors'

// Feature flags
export {
  OBS_ENABLED,
  OBS_DEBUG,
  SERVICE_NAME,
  OBS_ENV,
  OBS_REDACT_FIELDS,
  getObservabilityConfig,
} from './feature-flags'
