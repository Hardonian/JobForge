/**
 * Error normalization utilities
 *
 * Ensures errors are safe for logging (no secrets, normalized structure)
 */

import { generateCorrelationId } from '@jobforge/errors'

export interface NormalizedError {
  code: string
  message: string
  type: string
  correlation_id: string
  details?: Record<string, unknown>
}

/**
 * Error codes for consistent categorization
 */
export const ErrorCodes = {
  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  SCHEMA_ERROR: 'SCHEMA_ERROR',

  // Not found
  NOT_FOUND: 'NOT_FOUND',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',

  // Auth/Permission
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  PERMISSION_DENIED: 'PERMISSION_DENIED',

  // Rate limiting
  RATE_LIMITED: 'RATE_LIMITED',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // External services
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT_ERROR: 'TIMEOUT_ERROR',

  // Internal
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',

  // Database
  DATABASE_ERROR: 'DATABASE_ERROR',
  CONNECTION_ERROR: 'CONNECTION_ERROR',
  CONSTRAINT_ERROR: 'CONSTRAINT_ERROR',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Patterns that might indicate secrets in error messages
 */
const SECRET_PATTERNS = [
  /Bearer\s+\S+/gi,
  /token[=:]\s*\S+/gi,
  /api[_-]?key[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /password[=:]\s*\S+/gi,
  /auth[=:]\s*\S+/gi,
  /credential[=:]\s*\S+/gi,
  /private[_-]?key[=:]\s*\S+/gi,
  /session[=:]\s*\S+/gi,
  /jwt[=:]\s*\S+/gi,
]

/**
 * Normalize an error for safe logging
 *
 * @param error - The error to normalize
 * @param code - Optional error code override
 * @param includeStack - Whether to include stack trace (only in dev)
 * @returns Normalized error object safe for logging
 *
 * @example
 * ```typescript
 * try {
 *   await riskyOperation()
 * } catch (error) {
 *   const normalized = normalizeError(error)
 *   logger.error('Operation failed', { error: normalized })
 * }
 * ```
 */
export function normalizeError(
  error: Error | unknown,
  code?: ErrorCode,
  includeStack: boolean = false
): NormalizedError {
  const correlationId = generateCorrelationId()

  if (error instanceof Error) {
    const errorCode = code || inferErrorCode(error)
    const message = sanitizeErrorMessage(error.message)

    const normalized: NormalizedError = {
      code: errorCode,
      message,
      type: error.constructor.name,
      correlation_id: correlationId,
    }

    // Only include stack in local/dev environments
    if (includeStack && isDevelopment()) {
      normalized.details = {
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
      }
    }

    return normalized
  }

  // Handle non-Error objects
  const stringified = String(error)
  return {
    code: code || ErrorCodes.UNKNOWN_ERROR,
    message: sanitizeErrorMessage(stringified),
    type: 'Unknown',
    correlation_id: correlationId,
  }
}

/**
 * Sanitize error message to remove potential secrets
 */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message

  // Truncate very long messages
  const maxLength = 500
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...'
  }

  // Remove secrets
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]')
  }

  // Remove potential URLs with credentials
  sanitized = sanitized.replace(/https?:\/\/[^\s:@]+:[^\s@]+@[^\s]+/gi, '[REDACTED_URL]')

  return sanitized
}

/**
 * Infer error code from error type and message
 */
function inferErrorCode(error: Error): ErrorCode {
  const name = error.constructor.name.toLowerCase()
  const message = error.message.toLowerCase()

  // Validation
  if (
    name.includes('validation') ||
    name.includes('zoderror') ||
    message.includes('validation') ||
    message.includes('invalid') ||
    message.includes('required')
  ) {
    return ErrorCodes.VALIDATION_ERROR
  }

  // Not found
  if (
    name.includes('notfound') ||
    name.includes('notfounderror') ||
    message.includes('not found') ||
    message.includes('notfound') ||
    message.includes('does not exist') ||
    message.includes('not exist')
  ) {
    return ErrorCodes.NOT_FOUND
  }

  // Auth
  if (
    name.includes('unauthorized') ||
    name.includes('unauthenticated') ||
    message.includes('unauthorized') ||
    message.includes('unauthenticated') ||
    message.includes('auth failed') ||
    message.includes('authentication')
  ) {
    return ErrorCodes.UNAUTHORIZED
  }

  // Forbidden
  if (
    name.includes('forbidden') ||
    message.includes('forbidden') ||
    message.includes('permission') ||
    message.includes('access denied')
  ) {
    return ErrorCodes.FORBIDDEN
  }

  // Rate limit
  if (
    name.includes('ratelimit') ||
    name.includes('ratelimiterro') ||
    message.includes('rate limit') ||
    message.includes('too many') ||
    message.includes('throttled')
  ) {
    return ErrorCodes.RATE_LIMITED
  }

  // Timeout
  if (
    name.includes('timeout') ||
    name.includes('timeouterror') ||
    message.includes('timeout') ||
    message.includes('timed out')
  ) {
    return ErrorCodes.TIMEOUT_ERROR
  }

  // Network/External
  if (
    name.includes('network') ||
    name.includes('connection') ||
    message.includes('network') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('fetch failed')
  ) {
    return ErrorCodes.EXTERNAL_SERVICE_ERROR
  }

  // Database
  if (
    name.includes('database') ||
    name.includes('postgres') ||
    name.includes('sql') ||
    name.includes('query') ||
    message.includes('database') ||
    message.includes('postgres')
  ) {
    return ErrorCodes.DATABASE_ERROR
  }

  return ErrorCodes.INTERNAL_ERROR
}

/**
 * Check if we're in a development environment
 */
function isDevelopment(): boolean {
  if (typeof process === 'undefined') {
    return false
  }

  const env = process.env.NODE_ENV || process.env.ENV || 'development'
  return env === 'development' || env === 'dev' || env === 'local'
}

/**
 * Create a normalized error from a code and message
 */
export function createNormalizedError(
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>
): NormalizedError {
  return {
    code,
    message: sanitizeErrorMessage(message),
    type: 'AppError',
    correlation_id: generateCorrelationId(),
    details,
  }
}

/**
 * Wrap an async function with error normalization
 *
 * @example
 * ```typescript
 * const safeOperation = withNormalizedErrors(
 *   async () => await riskyOperation(),
 *   'OPERATION_ERROR'
 * )
 *
 * const result = await safeOperation()
 * ```
 */
export function withNormalizedErrors<T>(
  fn: () => Promise<T>,
  errorCode?: ErrorCode
): () => Promise<T> {
  return async () => {
    try {
      return await fn()
    } catch (error) {
      throw normalizeError(error, errorCode)
    }
  }
}
