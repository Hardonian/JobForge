/**
 * Log redaction utilities
 *
 * Automatically redacts sensitive fields from log objects to prevent
 * secrets, PII, and credentials from being logged.
 */

/**
 * Default patterns that trigger redaction
 */
export const DEFAULT_REDACTION_PATTERNS = [
  // Secrets and keys
  /password/i,
  /passwd/i,
  /secret/i,
  /api[_-]?key/i,
  /apikey/i,
  /auth[_-]?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /token/i,
  /bearer/i,
  /credential/i,
  /private[_-]?key/i,
  /privatekey/i,

  // PII
  /credit[_-]?card/i,
  /ssn/i,
  /social[_-]?security/i,

  // Headers
  /^authorization$/i,
  /^cookie$/i,
  /^x[-_]?api[-_]?key$/i,
  /^x[-_]?auth[-_]?token$/i,
]

/**
 * Redaction markers by severity/type
 */
export const REDACTION_MARKERS = {
  default: '[REDACTED]',
  key: '[REDACTED:KEY]',
  pii: '[REDACTED:PII]',
  auth: '[REDACTED:AUTH]',
  cookie: '[REDACTED:COOKIE]',
}

/**
 * Check if a key matches any redaction pattern
 */
function shouldRedact(key: string): boolean {
  return DEFAULT_REDACTION_PATTERNS.some((pattern) => pattern.test(key))
}

/**
 * Get the appropriate redaction marker for a key
 */
function getRedactionMarker(key: string): string {
  const lowerKey = key.toLowerCase()

  if (lowerKey.includes('cookie')) {
    return REDACTION_MARKERS.cookie
  }
  if (
    lowerKey.includes('authorization') ||
    lowerKey.includes('auth') ||
    lowerKey.includes('bearer')
  ) {
    return REDACTION_MARKERS.auth
  }
  if (lowerKey.includes('private') || lowerKey.includes('key')) {
    return REDACTION_MARKERS.key
  }
  if (lowerKey.includes('credit') || lowerKey.includes('ssn') || lowerKey.includes('social')) {
    return REDACTION_MARKERS.pii
  }

  return REDACTION_MARKERS.default
}

/**
 * Deep clone and redact sensitive fields from an object
 *
 * @param obj - The object to redact
 * @returns A new object with sensitive fields redacted
 *
 * @example
 * ```typescript
 * const safePayload = redactLogObject({
 *   user_id: '123',
 *   api_key: 'sk-abc123',
 *   password: 'secret123',
 *   metadata: { token: 'jwt-token-here' }
 * })
 * // Result: { user_id: '123', api_key: '[REDACTED]', password: '[REDACTED]', metadata: { token: '[REDACTED]' } }
 * ```
 */
export function redactLogObject<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactLogObject(item)) as unknown as T
  }

  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (shouldRedact(key)) {
      result[key] = getRedactionMarker(key)
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactLogObject(value)
    } else {
      result[key] = value
    }
  }

  return result as T
}

/**
 * Redact sensitive fields from HTTP headers
 *
 * @param headers - Headers object to redact
 * @returns Redacted headers safe for logging
 *
 * @example
 * ```typescript
 * const safeHeaders = redactHeaders({
 *   'Content-Type': 'application/json',
 *   'Authorization': 'Bearer secret-token',
 *   'Cookie': 'session=abc123'
 * })
 * // Result: { 'Content-Type': 'application/json', 'Authorization': '[REDACTED:AUTH]', 'Cookie': '[REDACTED:COOKIE]' }
 * ```
 */
export function redactHeaders(
  headers: Record<string, string | string[] | undefined>
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {}

  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue
    }

    if (shouldRedact(key)) {
      result[key] = getRedactionMarker(key)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Redact a URL by removing query parameters that might contain secrets
 *
 * @param url - URL to redact
 * @param sensitiveParams - Additional parameter names to redact
 * @returns Redacted URL string
 *
 * @example
 * ```typescript
 * const safeUrl = redactUrl('https://api.example.com/data?api_key=secret&user=john')
 * // Result: 'https://api.example.com/data?api_key=[REDACTED]&user=john'
 * ```
 */
export function redactUrl(url: string, sensitiveParams: string[] = []): string {
  try {
    const urlObj = new URL(url)
    const defaultSensitiveParams = ['api_key', 'apikey', 'token', 'secret', 'password', 'auth']
    const allSensitiveParams = [
      ...defaultSensitiveParams,
      ...sensitiveParams.map((p) => p.toLowerCase()),
    ]

    for (const [key] of urlObj.searchParams.entries()) {
      if (allSensitiveParams.some((param) => key.toLowerCase().includes(param))) {
        urlObj.searchParams.set(key, REDACTION_MARKERS.default)
      }
    }

    return urlObj.toString()
  } catch {
    // If URL parsing fails, return the original URL
    return url
  }
}

/**
 * Create a custom redactor with additional patterns
 *
 * @param additionalPatterns - Additional regex patterns to match
 * @returns Redactor function
 *
 * @example
 * ```typescript
 * const customRedact = createRedactor([/custom_secret/i, /internal_token/i])
 * const safe = customRedact({ custom_secret: 'value', normal: 'data' })
 * ```
 */
export function createRedactor(additionalPatterns: RegExp[]) {
  const allPatterns = [...DEFAULT_REDACTION_PATTERNS, ...additionalPatterns]

  return function customRedact<T>(obj: T): T {
    if (obj === null || obj === undefined) {
      return obj
    }

    if (typeof obj !== 'object') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => customRedact(item)) as unknown as T
    }

    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(obj)) {
      const shouldRedactKey = allPatterns.some((pattern) => pattern.test(key))

      if (shouldRedactKey) {
        result[key] = getRedactionMarker(key)
      } else if (typeof value === 'object' && value !== null) {
        result[key] = customRedact(value)
      } else {
        result[key] = value
      }
    }

    return result as T
  }
}
