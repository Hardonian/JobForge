/**
 * Registry Handshake System for JobForge
 * Publishes connectors and runner capabilities to the control plane
 * OPTIMIZED: Uses deterministic memoization for expensive validations
 */

import {
  ConnectorCapabilitySchema,
  RunnerCapabilitiesSchema,
  RegistryHandshakeRequestSchema,
  RegistryHandshakeResponseSchema,
  type ConnectorCapability,
  type RunnerCapabilities,
  type RegistryHandshakeRequest,
  type RegistryHandshakeResponse,
  SCHEMA_VERSION,
} from '@autopilot/contracts'
import { memoize } from './memoize'

export interface HandshakeValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

export interface HandshakePayload {
  request: RegistryHandshakeRequest
  validation: HandshakeValidationResult
}

/**
 * Validate connector definitions against contract schema
 */
export function validateConnectors(connectors: unknown[]): HandshakeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!Array.isArray(connectors) || connectors.length === 0) {
    errors.push('Connectors must be a non-empty array')
    return { valid: false, errors, warnings }
  }

  const connectorIds = new Set<string>()

  for (let i = 0; i < connectors.length; i++) {
    const connector = connectors[i]
    const result = ConnectorCapabilitySchema.safeParse(connector)

    if (!result.success) {
      errors.push(
        `Connector[${i}]: ${result.error.errors.map((e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`).join(', ')}`
      )
      continue
    }

    const validConnector = result.data

    // Check for duplicate IDs
    if (connectorIds.has(validConnector.connector_id)) {
      errors.push(`Connector[${i}]: Duplicate connector_id "${validConnector.connector_id}"`)
    }
    connectorIds.add(validConnector.connector_id)

    // Validate version format (semver-like)
    if (!/^\d+\.\d+\.\d+/.test(validConnector.version)) {
      warnings.push(
        `Connector[${i}]: Version "${validConnector.version}" should follow semantic versioning (e.g., 1.0.0)`
      )
    }

    // Check for supported job types
    if (validConnector.supported_job_types.length === 0) {
      warnings.push(`Connector[${i}]: No supported_job_types specified`)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate runner capabilities against contract schema
 */
export function validateRunnerCapabilities(capabilities: unknown): HandshakeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const result = RunnerCapabilitiesSchema.safeParse(capabilities)

  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
    return { valid: false, errors, warnings }
  }

  const validCapabilities = result.data

  // Validate runner_id format
  if (!/^[a-z0-9_-]+$/.test(validCapabilities.runner_id)) {
    warnings.push(
      `runner_id "${validCapabilities.runner_id}" should use lowercase alphanumeric, hyphens, and underscores only`
    )
  }

  // Validate version format
  if (!/^\d+\.\d+\.\d+/.test(validCapabilities.version)) {
    warnings.push(
      `Version "${validCapabilities.version}" should follow semantic versioning (e.g., 1.0.0)`
    )
  }

  // Check for supported connectors
  if (validCapabilities.supported_connectors.length === 0) {
    warnings.push('No supported_connectors specified')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Validate a complete registry handshake request
 */
export function validateRegistryHandshakeRequest(request: unknown): HandshakeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const result = RegistryHandshakeRequestSchema.safeParse(request)

  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
    return { valid: false, errors, warnings }
  }

  const validRequest = result.data

  // Validate connectors
  const connectorValidation = validateConnectors(validRequest.connectors)
  errors.push(...connectorValidation.errors)
  warnings.push(...connectorValidation.warnings)

  // Validate runner capabilities
  const runnerValidation = validateRunnerCapabilities(validRequest.runner_capabilities)
  errors.push(...runnerValidation.errors)
  warnings.push(...runnerValidation.warnings)

  // Check that runner supports all required capabilities from connectors
  const requiredCapabilities = new Set<string>()
  for (const connector of validRequest.connectors) {
    for (const cap of connector.required_capabilities) {
      requiredCapabilities.add(cap)
    }
  }

  const runnerFeatures = new Set<string>(validRequest.runner_capabilities.features)
  const missingCapabilities = Array.from(requiredCapabilities).filter(
    (cap) => !runnerFeatures.has(cap)
  )

  if (missingCapabilities.length > 0) {
    warnings.push(
      `Runner missing capabilities required by connectors: ${missingCapabilities.join(', ')}`
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Create a registry handshake request
 */
export function createRegistryHandshakeRequest(
  connectors: ConnectorCapability[],
  runnerCapabilities: RunnerCapabilities,
  options?: {
    instanceId?: string
    version?: string
    metadata?: Record<string, unknown>
  }
): HandshakePayload {
  const timestamp = new Date().toISOString()
  const instanceId = options?.instanceId || `jobforge-${Date.now()}`

  const request: RegistryHandshakeRequest = {
    schema_version: SCHEMA_VERSION,
    instance_id: instanceId,
    instance_type: 'jobforge',
    version: options?.version || '0.1.0',
    connectors,
    runner_capabilities: runnerCapabilities,
    metadata: options?.metadata,
    timestamp,
  }

  const validation = validateRegistryHandshakeRequest(request)

  return {
    request,
    validation,
  }
}

/**
 * Validate a registry handshake response from control plane
 */
export function validateRegistryHandshakeResponse(response: unknown): HandshakeValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const result = RegistryHandshakeResponseSchema.safeParse(response)

  if (!result.success) {
    errors.push(
      ...result.error.errors.map(
        (e: { path: (string | number)[]; message: string }) => `${e.path.join('.')}: ${e.message}`
      )
    )
    return { valid: false, errors, warnings }
  }

  const validResponse = result.data

  // Check for rejected connectors
  if (validResponse.rejected_connectors.length > 0) {
    warnings.push(
      `Control plane rejected ${validResponse.rejected_connectors.length} connector(s): ` +
        validResponse.rejected_connectors
          .map((c: { connector_id: string; reason: string }) => c.connector_id)
          .join(', ')
    )
  }

  // Check runner validation status
  if (!validResponse.runner_validation.valid) {
    warnings.push(
      `Runner validation failed with missing capabilities: ` +
        validResponse.runner_validation.missing_capabilities.join(', ')
    )
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

/**
 * Process a handshake response and extract actionable information
 */
export function processHandshakeResponse(response: unknown): {
  accepted: boolean
  acceptedConnectors: string[]
  rejectedConnectors: Array<{ connectorId: string; reason: string }>
  missingCapabilities: string[]
  warnings: string[]
} {
  const result = RegistryHandshakeResponseSchema.safeParse(response)

  if (!result.success) {
    return {
      accepted: false,
      acceptedConnectors: [],
      rejectedConnectors: [],
      missingCapabilities: [],
      warnings: [`Invalid response format: ${result.error.message}`],
    }
  }

  const validResponse = result.data

  return {
    accepted: validResponse.status === 'accepted',
    acceptedConnectors: validResponse.accepted_connectors,
    rejectedConnectors: validResponse.rejected_connectors.map(
      (c: { connector_id: string; reason: string }) => ({
        connectorId: c.connector_id,
        reason: c.reason,
      })
    ),
    missingCapabilities: validResponse.runner_validation.missing_capabilities,
    warnings: validResponse.runner_validation.warnings,
  }
}

/**
 * Main registry handshake function
 * Validates and prepares handshake data for the control plane
 */
export function registryHandshake(
  connectors: ConnectorCapability[],
  runnerCapabilities: RunnerCapabilities,
  options?: {
    instanceId?: string
    version?: string
    metadata?: Record<string, unknown>
  }
): {
  success: boolean
  payload: RegistryHandshakeRequest | null
  validation: HandshakeValidationResult
} {
  // Validate connectors
  const connectorValidation = validateConnectors(connectors)
  if (!connectorValidation.valid) {
    return {
      success: false,
      payload: null,
      validation: connectorValidation,
    }
  }

  // Validate runner capabilities
  const runnerValidation = validateRunnerCapabilities(runnerCapabilities)
  if (!runnerValidation.valid) {
    return {
      success: false,
      payload: null,
      validation: runnerValidation,
    }
  }

  // Create and validate handshake request
  const { request, validation } = createRegistryHandshakeRequest(
    connectors,
    runnerCapabilities,
    options
  )

  return {
    success: validation.valid,
    payload: validation.valid ? request : null,
    validation,
  }
}

// Re-export types from contracts for convenience
export {
  type ConnectorCapability,
  type RunnerCapabilities,
  type RegistryHandshakeRequest,
  type RegistryHandshakeResponse,
  ConnectorCapabilitySchema,
  RunnerCapabilitiesSchema,
  RegistryHandshakeRequestSchema,
  RegistryHandshakeResponseSchema,
}

// ============================================================================
// OPTIMIZED: Memoized validation functions for deterministic caching
// ============================================================================

/**
 * Cached version of validateConnectors
 * Uses deterministic caching to avoid re-validating identical connector arrays
 * Cache key is based on stable JSON serialization
 * TTL: 5 minutes (300000ms) - balances freshness with performance
 * Max size: 100 entries
 */
export const validateConnectorsCached = memoize(validateConnectors, {
  ttl: 300000,
  maxSize: 100,
  keyGenerator: (args) => JSON.stringify(args[0]), // Hash the connectors array
})

/**
 * Cached version of validateRunnerCapabilities
 * Cache key is based on stable JSON serialization
 * TTL: 5 minutes (300000ms)
 * Max size: 100 entries
 */
export const validateRunnerCapabilitiesCached = memoize(validateRunnerCapabilities, {
  ttl: 300000,
  maxSize: 100,
  keyGenerator: (args) => JSON.stringify(args[0]), // Hash the capabilities object
})

/**
 * Cached version of validateRegistryHandshakeRequest
 * Cache key is based on stable JSON serialization
 * TTL: 5 minutes (300000ms)
 * Max size: 50 entries (more expensive, fewer cached)
 */
export const validateRegistryHandshakeRequestCached = memoize(validateRegistryHandshakeRequest, {
  ttl: 300000,
  maxSize: 50,
  keyGenerator: (args) => JSON.stringify(args[0]), // Hash the request object
})
