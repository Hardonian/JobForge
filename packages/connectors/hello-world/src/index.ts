/**
 * @jobforge/connector-hello-world
 *
 * Example connector implementing the JobForge Connector Contract Kit.
 * Returns deterministic "Hello World" responses for testing and development.
 */

import { z } from 'zod'
import {
  type ConnectorFn,
  type RunConnectorParams,
  EvidenceBuilder,
  hashOutput,
} from '@jobforge/sdk'

// ============================================================================
// Hello World Connector Schema
// ============================================================================

export const HelloWorldInputSchema = z.object({
  message: z.string().min(1).max(100).default('Hello'),
  echo: z.boolean().default(true),
  delay_ms: z.number().int().min(0).max(5000).default(0),
})

export type HelloWorldInput = z.infer<typeof HelloWorldInputSchema>

// ============================================================================
// Hello World Connector Implementation
// ============================================================================

/**
 * Hello World Connector
 *
 * A simple connector that echoes back messages with deterministic behavior.
 * Perfect for testing the connector harness and understanding the contract.
 */
export const helloWorldConnector: ConnectorFn = async (params: RunConnectorParams) => {
  const builder = new EvidenceBuilder({
    connector_id: params.config.connector_id,
    trace_id: params.context.trace_id,
    tenant_id: params.context.tenant_id,
    input: params.input,
  })

  try {
    // Validate input against our schema
    const validatedInput = HelloWorldInputSchema.parse(params.input.payload)

    // Simulate processing delay if requested
    if (validatedInput.delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, validatedInput.delay_ms))
    }

    // Generate deterministic response
    const response = validatedInput.echo ? `${validatedInput.message} World!` : 'Hello World!'

    // Build success evidence
    const evidence = builder.buildSuccess({
      message: response,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    })

    return {
      ok: true,
      data: {
        message: response,
        echoed: validatedInput.echo,
        delay_used: validatedInput.delay_ms,
      },
      evidence,
    }
  } catch (error) {
    // Handle validation errors
    if (error instanceof z.ZodError) {
      const evidence = builder.buildFailure({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input parameters',
        retryable: false,
      })

      return {
        ok: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input parameters',
          retryable: false,
          debug: { zod_errors: error.issues },
        },
        evidence,
      }
    }

    // Handle other errors
    const evidence = builder.buildFailure({
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
      retryable: false,
    })

    return {
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
        retryable: false,
      },
      evidence,
    }
  }
}

// ============================================================================
// Connector Manifest
// ============================================================================

/**
 * Manifest for the Hello World connector
 */
export const HELLO_WORLD_MANIFEST = {
  connector_id: 'hello-world',
  version: '1.0.0',
  name: 'Hello World Connector',
  description: 'Example connector that echoes messages for testing the JobForge SDK',
  connector_type: 'utility' as const,
  auth_type: 'none' as const,
  supported_operations: ['echo', 'greet'],
  rate_limits: {
    requests_per_second: 10,
    burst_size: 20,
  },
  retry_policy: {
    max_retries: 0,
    base_delay_ms: 1000,
    max_delay_ms: 1000,
    backoff_multiplier: 1,
  },
  config_schema: {},
  capabilities: ['deterministic', 'fast', 'test-friendly'],
} as const

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a standard configuration for the Hello World connector
 */
export function createHelloWorldConfig(overrides?: Partial<typeof HELLO_WORLD_MANIFEST>) {
  return {
    connector_id: 'hello-world',
    auth_type: 'none' as const,
    settings: {},
    retry_policy: HELLO_WORLD_MANIFEST.retry_policy,
    timeout_ms: 5000,
    ...overrides,
  }
}

/**
 * Create a standard input for the Hello World connector
 */
export function createHelloWorldInput(
  message = 'Hello',
  options?: {
    echo?: boolean
    delay_ms?: number
  }
) {
  return {
    operation: 'echo',
    payload: {
      message,
      echo: options?.echo ?? true,
      delay_ms: options?.delay_ms ?? 0,
    },
  }
}

/**
 * Create a standard context for testing
 */
export function createHelloWorldContext(overrides?: {
  trace_id?: string
  tenant_id?: string
  dry_run?: boolean
}) {
  return {
    trace_id: overrides?.trace_id ?? 'test-trace-123',
    tenant_id: overrides?.tenant_id ?? '00000000-0000-0000-0000-000000000001',
    dry_run: overrides?.dry_run ?? false,
    attempt_no: 1,
  }
}
