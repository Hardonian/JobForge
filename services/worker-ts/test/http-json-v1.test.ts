import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { JobContext } from '@jobforge/shared'
import {
  httpJsonV1Handler,
  HttpJsonRequestSchema,
  HttpJsonResponseSchema,
  HttpJsonErrorEnvelopeSchema,
  HttpJsonConnectorError,
  getCircuitBreaker,
  recordSuccess,
  recordFailure,
  canExecute,
  getCircuitBreakerStatus,
  validateUrl,
  calculateRetryDelay,
  isRetryableStatus,
  isRetryableError,
  sleep,
  CIRCUIT_BREAKER_CONFIG,
} from '../src/handlers/http-json-v1'

// Mock global fetch with proper typing
const mockFetch = vi.fn()
global.fetch = mockFetch as unknown as typeof fetch

// Create a mock JobContext
const createMockContext = (overrides?: Partial<JobContext>): JobContext => ({
  job_id: 'test-job-001',
  tenant_id: 'test-tenant',
  attempt_no: 1,
  trace_id: 'trace-12345',
  heartbeat: vi.fn(),
  ...overrides,
})

describe('connector.http_json_v1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============================================================================
  // Schema Validation Tests
  // ============================================================================
  describe('Schema Validation', () => {
    describe('HttpJsonRequestSchema', () => {
      it('should validate valid request with minimal fields', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
        })
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.method).toBe('GET')
          expect(result.data.timeout_ms).toBe(30_000)
        }
      })

      it('should validate valid request with all fields', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
          body: { key: 'value' },
          timeout_ms: 10_000,
          retry_config: {
            max_retries: 5,
            initial_delay_ms: 500,
            max_delay_ms: 10_000,
            backoff_multiplier: 1.5,
            retryable_status_codes: [500, 502, 503],
          },
          idempotency_key: 'idemp-123',
          allowlist: ['api.example.com', '*.trusted.com'],
          redact_headers: ['authorization', 'cookie'],
          validate_ssl: true,
          follow_redirects: true,
          max_redirects: 3,
          response_preview_max_bytes: 50_000,
        })
        expect(result.success).toBe(true)
      })

      it('should reject invalid URL', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'not-a-valid-url',
        })
        expect(result.success).toBe(false)
      })

      it('should reject URL exceeding max length', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/' + 'a'.repeat(3000),
        })
        expect(result.success).toBe(false)
      })

      it('should reject invalid HTTP method', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
          method: 'INVALID',
        })
        expect(result.success).toBe(false)
      })

      it('should reject timeout exceeding max', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
          timeout_ms: 400_000,
        })
        expect(result.success).toBe(false)
      })

      it('should reject negative retry values', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
          retry_config: { max_retries: -1 },
        })
        expect(result.success).toBe(false)
      })

      it('should reject retry config exceeding max values', () => {
        const result = HttpJsonRequestSchema.safeParse({
          url: 'https://api.example.com/data',
          retry_config: { max_retries: 15 },
        })
        expect(result.success).toBe(false)
      })
    })

    describe('HttpJsonResponseSchema', () => {
      it('should validate valid response', () => {
        const result = HttpJsonResponseSchema.safeParse({
          success: true,
          status_code: 200,
          status_text: 'OK',
          headers: { 'content-type': 'application/json' },
          body_preview: '{"data": "test"}',
          body_truncated: false,
          duration_ms: 123,
          attempt_count: 1,
          correlation_id: 'trace-123',
        })
        expect(result.success).toBe(true)
      })

      it('should reject invalid status code', () => {
        const result = HttpJsonResponseSchema.safeParse({
          success: true,
          status_code: 999,
          status_text: 'OK',
          headers: {},
          body_preview: '',
          body_truncated: false,
          duration_ms: 123,
          attempt_count: 1,
        })
        expect(result.success).toBe(false)
      })
    })

    describe('HttpJsonErrorEnvelopeSchema', () => {
      it('should validate valid error envelope', () => {
        const result = HttpJsonErrorEnvelopeSchema.safeParse({
          code: 'TIMEOUT_ERROR',
          message: 'Request timed out',
          correlation_id: 'trace-123',
          details: { timeout_ms: 30_000 },
          timestamp: new Date().toISOString(),
          request_info: {
            url: 'https://api.example.com/data',
            method: 'GET',
            attempt_count: 3,
            last_status_code: 500,
          },
        })
        expect(result.success).toBe(true)
      })

      it('should reject invalid error code', () => {
        const result = HttpJsonErrorEnvelopeSchema.safeParse({
          code: 'UNKNOWN_ERROR',
          message: 'Something went wrong',
          timestamp: new Date().toISOString(),
        })
        expect(result.success).toBe(false)
      })
    })
  })

  // ============================================================================
  // SSRF Protection Tests
  // ============================================================================
  describe('SSRF Protection', () => {
    it('should block localhost', () => {
      expect(() => validateUrl('http://localhost/api')).toThrow('Blocked host')
      expect(() => validateUrl('http://127.0.0.1/api')).toThrow('Blocked host')
      expect(() => validateUrl('http://0.0.0.0/api')).toThrow('Blocked host')
    })

    it('should block private IP ranges', () => {
      expect(() => validateUrl('http://10.0.0.1/api')).toThrow('Private IP address not allowed')
      expect(() => validateUrl('http://192.168.1.1/api')).toThrow('Private IP address not allowed')
      expect(() => validateUrl('http://172.16.0.1/api')).toThrow('Private IP address not allowed')
    })

    it('should block cloud metadata endpoints', () => {
      expect(() => validateUrl('http://169.254.169.254/metadata')).toThrow('Blocked host')
      expect(() => validateUrl('http://metadata.google.internal')).toThrow('Blocked host')
    })

    it('should block non-HTTP protocols', () => {
      expect(() => validateUrl('file:///etc/passwd')).toThrow('Blocked protocol')
      expect(() => validateUrl('ftp://example.com/file')).toThrow('Blocked protocol')
      expect(() => validateUrl('data:text/plain,test')).toThrow('Blocked protocol')
    })

    it('should allow valid public URLs', () => {
      expect(() => validateUrl('https://api.example.com/data')).not.toThrow()
      expect(() => validateUrl('http://example.com/api')).not.toThrow()
    })

    it('should enforce allowlist when provided', () => {
      expect(() => validateUrl('https://api.example.com/data', ['api.example.com'])).not.toThrow()
      expect(() => validateUrl('https://api.example.com/data', ['*.example.com'])).not.toThrow()
      expect(() => validateUrl('https://other.com/data', ['api.example.com'])).toThrow(
        'Host not in allowlist'
      )
    })

    it('should handle allowlist wildcards', () => {
      expect(() => validateUrl('https://sub.example.com', ['*.example.com'])).not.toThrow()
      expect(() => validateUrl('https://deep.sub.example.com', ['*.example.com'])).not.toThrow()
      expect(() => validateUrl('https://other.com', ['*.example.com'])).toThrow(
        'Host not in allowlist'
      )
    })
  })

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================
  describe('Retry Logic', () => {
    describe('calculateRetryDelay', () => {
      it('should calculate exponential backoff', () => {
        const config = {
          max_retries: 3,
          initial_delay_ms: 1000,
          max_delay_ms: 30_000,
          backoff_multiplier: 2,
          retryable_status_codes: [500],
        }

        const delay1 = calculateRetryDelay(1, config)
        const delay2 = calculateRetryDelay(2, config)
        const delay3 = calculateRetryDelay(3, config)

        // With jitter, check ranges
        expect(delay1).toBeGreaterThan(700)
        expect(delay1).toBeLessThan(1300)

        expect(delay2).toBeGreaterThan(1500)
        expect(delay2).toBeLessThan(2500)

        expect(delay3).toBeGreaterThan(3000)
        expect(delay3).toBeLessThan(5000)
      })

      it('should respect max delay cap', () => {
        const config = {
          max_retries: 10,
          initial_delay_ms: 1000,
          max_delay_ms: 5000,
          backoff_multiplier: 2,
          retryable_status_codes: [500],
        }

        const delay = calculateRetryDelay(10, config)
        expect(delay).toBeLessThanOrEqual(5000 * 1.25) // Max + jitter
      })
    })

    describe('isRetryableStatus', () => {
      it('should identify retryable status codes', () => {
        expect(isRetryableStatus(408, [408, 429, 500, 502, 503, 504])).toBe(true)
        expect(isRetryableStatus(429, [408, 429, 500, 502, 503, 504])).toBe(true)
        expect(isRetryableStatus(500, [408, 429, 500, 502, 503, 504])).toBe(true)
        expect(isRetryableStatus(503, [408, 429, 500, 502, 503, 504])).toBe(true)
      })

      it('should reject non-retryable status codes', () => {
        expect(isRetryableStatus(200, [408, 429, 500, 502, 503, 504])).toBe(false)
        expect(isRetryableStatus(400, [408, 429, 500, 502, 503, 504])).toBe(false)
        expect(isRetryableStatus(404, [408, 429, 500, 502, 503, 504])).toBe(false)
      })
    })

    describe('isRetryableError', () => {
      it('should identify timeout errors', () => {
        const timeoutError = new Error('Timeout')
        timeoutError.name = 'TimeoutError'
        expect(isRetryableError(timeoutError)).toBe(true)

        const abortError = new Error('Aborted')
        abortError.name = 'AbortError'
        expect(isRetryableError(abortError)).toBe(true)
      })

      it('should identify connection errors', () => {
        expect(isRetryableError(new Error('ECONNRESET'))).toBe(true)
        expect(isRetryableError(new Error('ETIMEDOUT'))).toBe(true)
        expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true)
        expect(isRetryableError(new Error('ENOTFOUND'))).toBe(true)
      })

      it('should reject non-retryable errors', () => {
        expect(isRetryableError(new Error('Generic error'))).toBe(false)
        expect(isRetryableError(new Error('Invalid input'))).toBe(false)
      })
    })

    describe('sleep', () => {
      it('should sleep for specified duration', async () => {
        const start = Date.now()
        await sleep(50)
        const elapsed = Date.now() - start
        expect(elapsed).toBeGreaterThanOrEqual(45) // Allow small variance
      })
    })
  })

  // ============================================================================
  // Circuit Breaker Tests
  // ============================================================================
  describe('Circuit Breaker', () => {
    const testEndpoint = 'https://test.example.com'

    beforeEach(() => {
      // Reset circuit breaker state by recording multiple successes
      for (let i = 0; i < 10; i++) {
        recordSuccess(testEndpoint)
      }
    })

    it('should start in CLOSED state', () => {
      expect(canExecute(testEndpoint)).toBe(true)
      const status = getCircuitBreakerStatus(testEndpoint)
      expect(status.open).toBe(false)
    })

    it('should open after threshold failures', () => {
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        recordFailure(testEndpoint)
      }

      expect(canExecute(testEndpoint)).toBe(false)
      const status = getCircuitBreakerStatus(testEndpoint)
      expect(status.open).toBe(true)
      expect(status.remainingCooldownMs).toBeGreaterThan(0)
    })

    it('should transition to HALF_OPEN after cooldown', async () => {
      // Open the circuit
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        recordFailure(testEndpoint)
      }
      expect(canExecute(testEndpoint)).toBe(false)

      // Wait for cooldown
      await sleep(CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 100)

      // Should be in HALF_OPEN
      expect(canExecute(testEndpoint)).toBe(true)
    })

    it('should close after success in HALF_OPEN', async () => {
      // Open the circuit
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        recordFailure(testEndpoint)
      }

      // Wait for cooldown
      await sleep(CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 100)

      // Record success
      recordSuccess(testEndpoint)

      const status = getCircuitBreakerStatus(testEndpoint)
      expect(status.open).toBe(false)
    })

    it('should track remaining cooldown time accurately', async () => {
      // Open the circuit
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        recordFailure(testEndpoint)
      }

      const status1 = getCircuitBreakerStatus(testEndpoint)
      expect(status1.open).toBe(true)
      expect(status1.remainingCooldownMs).toBeGreaterThan(0)
      expect(status1.remainingCooldownMs).toBeLessThanOrEqual(CIRCUIT_BREAKER_CONFIG.resetTimeoutMs)

      // Wait a bit
      await sleep(500)

      const status2 = getCircuitBreakerStatus(testEndpoint)
      expect(status2.remainingCooldownMs).toBeLessThan(status1.remainingCooldownMs)
    })
  })

  // ============================================================================
  // Handler Integration Tests
  // ============================================================================
  describe('httpJsonV1Handler Integration', () => {
    it('should successfully execute a simple GET request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"data": "test"}',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler({ url: 'https://api.example.com/data' }, context)

      expect(result.success).toBe(true)
      expect(result.status_code).toBe(200)
      expect(result.body_preview).toBe('{"data": "test"}')
      expect(result.correlation_id).toBe('trace-12345')
    })

    it('should execute POST request with JSON body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"id": 123}',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler(
        {
          url: 'https://api.example.com/items',
          method: 'POST',
          body: { name: 'Test Item' },
        },
        context
      )

      expect(result.success).toBe(true)
      expect(result.status_code).toBe(201)

      // Verify fetch was called with correct body
      const callArgs = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(callArgs[1].method).toBe('POST')
      expect(callArgs[1].body).toBe('{"name":"Test Item"}')
      expect(callArgs[1].headers['content-type']).toBe('application/json')
    })

    it('should handle validation errors with proper envelope', async () => {
      const context = createMockContext()

      await expect(httpJsonV1Handler({ url: 'invalid-url' }, context)).rejects.toThrow(
        HttpJsonConnectorError
      )

      try {
        await httpJsonV1Handler({ url: 'invalid-url' }, context)
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('VALIDATION_ERROR')
        expect(connectorError.correlationId).toBe('trace-12345')
        expect(connectorError.toEnvelope().timestamp).toBeDefined()
      }
    })

    it('should handle SSRF blocked requests', async () => {
      const context = createMockContext()

      try {
        await httpJsonV1Handler({ url: 'http://localhost/admin' }, context)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('SSRF_BLOCKED')
        expect(connectorError.message).toContain('localhost')
      }
    })

    it('should handle successful retry on transient failure', async () => {
      // First attempt fails with 503, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers(),
          text: async () => 'Error',
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers(),
          text: async () => '{"data": "success"}',
        } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler(
        {
          url: 'https://api.example.com/data',
          retry_config: { max_retries: 3, initial_delay_ms: 10 },
        },
        context
      )

      expect(result.success).toBe(true)
      expect(result.status_code).toBe(200)
      expect(result.attempt_count).toBe(2)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('should handle timeout errors', async () => {
      mockFetch.mockImplementationOnce(() => {
        const error = new Error('Request timeout after 100ms')
        error.name = 'TimeoutError'
        throw error
      })

      const context = createMockContext()

      try {
        await httpJsonV1Handler(
          {
            url: 'https://api.example.com/slow',
            timeout_ms: 100,
            retry_config: { max_retries: 0 },
          },
          context
        )
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        // TimeoutError is a retryable error, so it will retry. With 0 retries, we should get NETWORK_ERROR
        expect(connectorError.code).toBe('NETWORK_ERROR')
      }
    })

    it('should redact sensitive headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'application/json',
          authorization: 'Bearer secret-token',
          cookie: 'session=abc',
          'x-custom': 'visible',
        }),
        text: async () => '{}',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler({ url: 'https://api.example.com/data' }, context)

      expect(result.headers['authorization']).toBeUndefined()
      expect(result.headers['cookie']).toBeUndefined()
      expect(result.headers['x-custom']).toBe('visible')
    })

    it('should truncate large response bodies', async () => {
      const largeBody = 'x'.repeat(200_000)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => largeBody,
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler(
        {
          url: 'https://api.example.com/large',
          response_preview_max_bytes: 50_000,
        },
        context
      )

      expect(result.body_truncated).toBe(true)
      expect(result.body_preview.length).toBeLessThanOrEqual(50_000 + 20) // + "... (truncated)"
    })

    it('should pass idempotency key through', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => '{}',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler(
        {
          url: 'https://api.example.com/data',
          idempotency_key: 'idemp-key-123',
        },
        context
      )

      expect(result.idempotency_key).toBe('idemp-key-123')
    })
  })

  // ============================================================================
  // Degraded Behavior Tests (Endpoint Down)
  // ============================================================================
  describe('Degraded Behavior - Endpoint Down', () => {
    it('should handle complete network failure with retries', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const context = createMockContext()

      try {
        await httpJsonV1Handler(
          {
            url: 'https://down.example.com/api',
            retry_config: { max_retries: 2, initial_delay_ms: 10 },
          },
          context
        )
        expect.fail('Expected handler to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('NETWORK_ERROR')
      }

      // Should have attempted all retries
      expect(mockFetch).toHaveBeenCalledTimes(3) // initial + 2 retries
    })

    it('should open circuit breaker after repeated failures', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const context = createMockContext()
      const url = 'https://failing.example.com/api'

      // First batch of requests - will fail and trigger circuit breaker
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold + 1; i++) {
        try {
          await httpJsonV1Handler(
            { url, retry_config: { max_retries: 0 } },
            createMockContext({ trace_id: `trace-${i}` })
          )
        } catch {
          // Expected
        }
      }

      // Circuit breaker should now be open
      const status = getCircuitBreakerStatus(url)
      expect(status.open).toBe(true)

      // Next request should fail immediately with CIRCUIT_BREAKER_OPEN
      try {
        await httpJsonV1Handler({ url }, context)
        expect.fail('Expected handler to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('CIRCUIT_BREAKER_OPEN')
      }

      // Should not have called fetch again (circuit breaker blocked it)
      const fetchCallCount = (mockFetch as ReturnType<typeof vi.fn>).mock.calls.length
      try {
        await httpJsonV1Handler({ url }, context)
        expect.fail('Expected handler to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('CIRCUIT_BREAKER_OPEN')
      }
      expect((mockFetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallCount)
    })

    it('should recover after circuit breaker cooldown', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => '{"recovered": true}',
      } as Response)

      const context = createMockContext()
      const url = 'https://recovering.example.com/api'

      // Open the circuit with failures
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        try {
          await httpJsonV1Handler(
            { url, retry_config: { max_retries: 0 } },
            createMockContext({ trace_id: `trace-${i}` })
          )
        } catch {
          // Expected
        }
      }

      // Circuit should be open
      expect(getCircuitBreakerStatus(url).open).toBe(true)

      // Wait for cooldown
      await sleep(CIRCUIT_BREAKER_CONFIG.resetTimeoutMs + 100)

      // Next request should succeed
      const result = await httpJsonV1Handler({ url }, context)
      expect(result.success).toBe(true)

      // Circuit should be closed
      expect(getCircuitBreakerStatus(url).open).toBe(false)
    })

    it('should handle non-retryable HTTP errors immediately', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: new Headers(),
        text: async () => 'Invalid input',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler({ url: 'https://api.example.com/data' }, context)

      // 400 is not retryable, should succeed with success=false
      expect(result.success).toBe(false)
      expect(result.status_code).toBe(400)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No retries
    })

    it('should report remaining cooldown in error details', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      const url = 'https://cooldown.example.com/api'

      // Open the circuit
      for (let i = 0; i < CIRCUIT_BREAKER_CONFIG.failureThreshold; i++) {
        try {
          await httpJsonV1Handler(
            { url, retry_config: { max_retries: 0 } },
            createMockContext({ trace_id: `trace-${i}` })
          )
        } catch {
          // Expected
        }
      }

      const context = createMockContext()

      try {
        await httpJsonV1Handler({ url }, context)
        expect.fail('Expected handler to throw')
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        expect(connectorError.code).toBe('CIRCUIT_BREAKER_OPEN')
        expect(connectorError.details?.remaining_cooldown_ms).toBeGreaterThan(0)
        expect(connectorError.details?.remaining_cooldown_ms).toBeLessThanOrEqual(
          CIRCUIT_BREAKER_CONFIG.resetTimeoutMs
        )
      }
    })
  })

  // ============================================================================
  // Contract Tests
  // ============================================================================
  describe('Contract Tests', () => {
    it('should produce valid response for successful request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => '{"status": "ok"}',
      } as Response)

      const context = createMockContext()
      const result = await httpJsonV1Handler({ url: 'https://api.example.com/health' }, context)

      // Validate response against schema
      const validation = HttpJsonResponseSchema.safeParse(result)
      expect(validation.success).toBe(true)
    })

    it('should produce valid error envelope for failures', async () => {
      const context = createMockContext()

      try {
        await httpJsonV1Handler({ url: 'http://localhost/admin' }, context)
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        const envelope = connectorError.toEnvelope()

        // Validate envelope against schema
        const validation = HttpJsonErrorEnvelopeSchema.safeParse(envelope)
        expect(validation.success).toBe(true)

        // Check required fields
        expect(envelope.code).toBe('SSRF_BLOCKED')
        expect(envelope.message).toBeDefined()
        expect(envelope.timestamp).toBeDefined()
        expect(envelope.correlation_id).toBe('trace-12345')
      }
    })

    it('should include request info in error envelopes', async () => {
      mockFetch.mockRejectedValue(new Error('ENOTFOUND'))

      const context = createMockContext()

      try {
        await httpJsonV1Handler(
          {
            url: 'https://nonexistent.example.com/api',
            method: 'POST',
            retry_config: { max_retries: 2, initial_delay_ms: 10 },
          },
          context
        )
      } catch (error) {
        expect(error).toBeInstanceOf(HttpJsonConnectorError)
        const connectorError = error as HttpJsonConnectorError
        const envelope = connectorError.toEnvelope()

        expect(envelope.request_info).toBeDefined()
        expect(envelope.request_info?.url).toBe('https://nonexistent.example.com/api')
        expect(envelope.request_info?.method).toBe('POST')
        expect(envelope.request_info?.attempt_count).toBeGreaterThan(0)
      }
    })

    it('should maintain correlation ID throughout request lifecycle', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        text: async () => '{}',
      } as Response)

      const customTraceId = 'custom-trace-abc123'
      const context = createMockContext({ trace_id: customTraceId })
      const result = await httpJsonV1Handler({ url: 'https://api.example.com/data' }, context)

      expect(result.correlation_id).toBe(customTraceId)
    })
  })
})
