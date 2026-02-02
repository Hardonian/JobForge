/**
 * @jobforge/client - Unit tests
 * Tests for schema validation and error handling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  eventEnvelopeSchema,
  submitEventParamsSchema,
  requestJobParamsSchema,
  getRunStatusParamsSchema,
  getRunManifestParamsSchema,
  listArtifactsParamsSchema,
} from '../src/schemas'
import { JobForgeClientError } from '../src/types'

describe('Schema Validation', () => {
  describe('eventEnvelopeSchema', () => {
    it('should validate a valid event envelope', () => {
      const validEnvelope = {
        event_version: '1.0' as const,
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-123',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        source_app: 'settler' as const,
        source_module: 'core' as const,
        subject: { type: 'test', id: '123' },
        payload: { foo: 'bar' },
        contains_pii: false,
      }

      const result = eventEnvelopeSchema.safeParse(validEnvelope)
      expect(result.success).toBe(true)
    })

    it('should reject missing required fields', () => {
      const invalidEnvelope = {
        event_type: 'test.event',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        source_app: 'settler',
        contains_pii: false,
      }

      const result = eventEnvelopeSchema.safeParse(invalidEnvelope)
      expect(result.success).toBe(false)
    })

    it('should reject invalid tenant_id format', () => {
      const invalidEnvelope = {
        event_version: '1.0',
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-123',
        tenant_id: 'not-a-uuid',
        source_app: 'settler',
        payload: {},
        contains_pii: false,
      }

      const result = eventEnvelopeSchema.safeParse(invalidEnvelope)
      expect(result.success).toBe(false)
    })

    it('should reject invalid source_app', () => {
      const invalidEnvelope = {
        event_version: '1.0',
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-123',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        source_app: 'invalid_app',
        payload: {},
        contains_pii: false,
      }

      const result = eventEnvelopeSchema.safeParse(invalidEnvelope)
      expect(result.success).toBe(false)
    })

    it('should accept minimal valid envelope', () => {
      const minimalEnvelope = {
        event_version: '1.0' as const,
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-123',
        tenant_id: '550e8400-e29b-41d4-a716-446655440000',
        source_app: 'external' as const,
        payload: {},
        contains_pii: false,
      }

      const result = eventEnvelopeSchema.safeParse(minimalEnvelope)
      expect(result.success).toBe(true)
    })
  })

  describe('submitEventParamsSchema', () => {
    it('should validate submit event params', () => {
      const validParams = {
        envelope: {
          event_version: '1.0' as const,
          event_type: 'test.event',
          occurred_at: new Date().toISOString(),
          trace_id: 'trace-123',
          tenant_id: '550e8400-e29b-41d4-a716-446655440000',
          source_app: 'settler' as const,
          payload: {},
          contains_pii: false,
        },
      }

      const result = submitEventParamsSchema.safeParse(validParams)
      expect(result.success).toBe(true)
    })
  })

  describe('requestJobParamsSchema', () => {
    it('should validate valid job request params', () => {
      const validParams = {
        jobType: 'autopilot.ops.scan',
        inputs: { scan_type: 'full' },
        tenantId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440001',
        traceId: 'trace-123',
        idempotencyKey: 'unique-key',
        sourceApp: 'settler' as const,
        sourceModule: 'core' as const,
        dryRun: true,
      }

      const result = requestJobParamsSchema.safeParse(validParams)
      expect(result.success).toBe(true)
    })

    it('should accept minimal job request params', () => {
      const minimalParams = {
        jobType: 'autopilot.ops.scan',
        inputs: {},
        tenantId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: 'trace-123',
        sourceApp: 'settler' as const,
      }

      const result = requestJobParamsSchema.safeParse(minimalParams)
      expect(result.success).toBe(true)
    })

    it('should reject missing job type', () => {
      const invalidParams = {
        inputs: {},
        tenantId: '550e8400-e29b-41d4-a716-446655440000',
        traceId: 'trace-123',
        sourceApp: 'settler',
      }

      const result = requestJobParamsSchema.safeParse(invalidParams)
      expect(result.success).toBe(false)
    })

    it('should reject invalid tenant ID', () => {
      const invalidParams = {
        jobType: 'autopilot.ops.scan',
        inputs: {},
        tenantId: 'invalid-tenant-id',
        traceId: 'trace-123',
        sourceApp: 'settler',
      }

      const result = requestJobParamsSchema.safeParse(invalidParams)
      expect(result.success).toBe(false)
    })
  })

  describe('getRunStatusParamsSchema', () => {
    it('should validate valid params', () => {
      const validParams = {
        runId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
      }

      const result = getRunStatusParamsSchema.safeParse(validParams)
      expect(result.success).toBe(true)
    })

    it('should reject invalid run ID', () => {
      const invalidParams = {
        runId: 'not-a-uuid',
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
      }

      const result = getRunStatusParamsSchema.safeParse(invalidParams)
      expect(result.success).toBe(false)
    })
  })

  describe('getRunManifestParamsSchema', () => {
    it('should validate valid params', () => {
      const validParams = {
        runId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
      }

      const result = getRunManifestParamsSchema.safeParse(validParams)
      expect(result.success).toBe(true)
    })
  })

  describe('listArtifactsParamsSchema', () => {
    it('should validate valid params', () => {
      const validParams = {
        runId: '550e8400-e29b-41d4-a716-446655440000',
        tenantId: '550e8400-e29b-41d4-a716-446655440001',
      }

      const result = listArtifactsParamsSchema.safeParse(validParams)
      expect(result.success).toBe(true)
    })
  })
})

describe('JobForgeClientError', () => {
  it('should create error with code and message', () => {
    const error = new JobForgeClientError('VALIDATION_ERROR', 'Invalid input')

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.message).toBe('Invalid input')
    expect(error.name).toBe('JobForgeClientError')
  })

  it('should create error with cause', () => {
    const cause = new Error('Original error')
    const error = new JobForgeClientError('TRANSPORT_ERROR', 'Request failed', cause)

    expect(error.code).toBe('TRANSPORT_ERROR')
    expect(error.cause).toBe(cause)
  })

  it('should be instanceof Error', () => {
    const error = new JobForgeClientError('INTERNAL_ERROR', 'Something went wrong')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(JobForgeClientError)
  })
})
