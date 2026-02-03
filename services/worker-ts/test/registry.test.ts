import { describe, it, expect } from 'vitest'
import { createDefaultRegistry } from '../src/handlers/index'
import { HttpJsonRequestSchema } from '../src/handlers/http-json-v1'

describe('connector.http_json_v1 Registry Registration', () => {
  it('should be registered in default registry', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('connector.http_json_v1')).toBe(true)
  })

  it('should have proper handler registration options', () => {
    const registry = createDefaultRegistry()
    const registration = registry.get('connector.http_json_v1')

    expect(registration).toBeDefined()
    expect(registration?.options?.timeoutMs).toBe(120_000) // 2 minutes
    expect(registration?.options?.maxAttempts).toBe(5)
    expect(typeof registration?.options?.validate).toBe('function')
  })

  it('should validate payload using zod schema', () => {
    const registry = createDefaultRegistry()
    const registration = registry.get('connector.http_json_v1')

    // Valid payload should pass
    const validPayload = {
      url: 'https://api.example.com/data',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { key: 'value' },
    }
    expect(registration?.options?.validate?.(validPayload)).toBe(true)

    // Invalid payload should fail
    const invalidPayload = {
      url: 'not-a-valid-url',
    }
    expect(registration?.options?.validate?.(invalidPayload)).toBe(false)

    // Missing URL should fail
    const missingUrlPayload = {
      method: 'GET',
    }
    expect(registration?.options?.validate?.(missingUrlPayload)).toBe(false)
  })

  it('should handle all valid HTTP methods', () => {
    const registry = createDefaultRegistry()
    const registration = registry.get('connector.http_json_v1')

    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    for (const method of methods) {
      const payload = {
        url: 'https://api.example.com/data',
        method,
      }
      expect(registration?.options?.validate?.(payload)).toBe(true)
    }
  })

  it('should reject invalid HTTP methods', () => {
    const registry = createDefaultRegistry()
    const registration = registry.get('connector.http_json_v1')

    const invalidPayload = {
      url: 'https://api.example.com/data',
      method: 'TRACE', // Not in allowed enum
    }
    expect(registration?.options?.validate?.(invalidPayload)).toBe(false)
  })

  it('should be distinct from basic http.request handler', () => {
    const registry = createDefaultRegistry()

    expect(registry.has('connector.http.request')).toBe(true)
    expect(registry.has('connector.http_json_v1')).toBe(true)

    const basicHandler = registry.get('connector.http.request')
    const advancedHandler = registry.get('connector.http_json_v1')

    expect(basicHandler?.handler).not.toBe(advancedHandler?.handler)
    expect(basicHandler?.options?.timeoutMs).toBe(60_000)
    expect(advancedHandler?.options?.timeoutMs).toBe(120_000)
  })

  it('should export handler for testing', () => {
    // Verify the handler is exported from the index
    const { httpJsonV1Handler } = require('../src/handlers/index')
    expect(typeof httpJsonV1Handler).toBe('function')
  })

  describe('Capabilities', () => {
    it('should support idempotent operations with retry config', () => {
      const registry = createDefaultRegistry()
      const registration = registry.get('connector.http_json_v1')

      const payload = {
        url: 'https://api.example.com/data',
        idempotency_key: 'idemp-123',
        retry_config: {
          max_retries: 5,
          initial_delay_ms: 1000,
          retryable_status_codes: [500, 502, 503, 504],
        },
      }

      expect(registration?.options?.validate?.(payload)).toBe(true)
    })

    it('should support SSRF allowlist', () => {
      const registry = createDefaultRegistry()
      const registration = registry.get('connector.http_json_v1')

      const payload = {
        url: 'https://api.example.com/data',
        allowlist: ['api.example.com', '*.trusted.com'],
      }

      expect(registration?.options?.validate?.(payload)).toBe(true)
    })

    it('should support custom timeout configuration', () => {
      const registry = createDefaultRegistry()
      const registration = registry.get('connector.http_json_v1')

      const payload = {
        url: 'https://api.example.com/data',
        timeout_ms: 60_000,
      }

      expect(registration?.options?.validate?.(payload)).toBe(true)
    })

    it('should reject timeout exceeding maximum', () => {
      const registry = createDefaultRegistry()
      const registration = registry.get('connector.http_json_v1')

      const payload = {
        url: 'https://api.example.com/data',
        timeout_ms: 400_000, // Exceeds 300_000 max
      }

      expect(registration?.options?.validate?.(payload)).toBe(false)
    })
  })
})
