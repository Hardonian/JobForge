/**
 * Connector Registry Finalization System
 * - Normalizes connector metadata (capabilities, auth, rate limits, failure modes)
 * - Machine-readable registry index (JSON + README sync)
 * - "unsupported / partial / experimental" flags
 */

import { z } from 'zod'
import { type ConnectorCapability } from '@autopilot/contracts'

// ============================================================================
// Connector Status Enum
// ============================================================================

export const CONNECTOR_STATUS = {
  UNSUPPORTED: 'unsupported',
  PARTIAL: 'partial',
  EXPERIMENTAL: 'experimental',
  BETA: 'beta',
  STABLE: 'stable',
  DEPRECATED: 'deprecated',
} as const

export type ConnectorStatus = (typeof CONNECTOR_STATUS)[keyof typeof CONNECTOR_STATUS]

// ============================================================================
// Connector Metadata Schema (Normalized)
// ============================================================================

export const ConnectorMetadataSchema = z.object({
  connector_id: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+/),

  // Status and maturity
  status: z.nativeEnum(CONNECTOR_STATUS),
  maturity: z.enum(['alpha', 'beta', 'production']),

  // Display information
  name: z.string().min(1),
  description: z.string().min(1).max(1000),
  icon: z.string().url().optional(),
  documentation_url: z.string().url().optional(),

  // Supported job types
  supported_job_types: z.array(z.string()).min(1),

  // Capabilities matrix
  capabilities: z.object({
    bidirectional: z.boolean(),
    streaming: z.boolean(),
    batch: z.boolean(),
    real_time: z.boolean(),
    webhook: z.boolean(),
    polling: z.boolean(),
  }),

  // Authentication requirements
  auth: z.object({
    required: z.boolean(),
    methods: z.array(z.enum(['oauth2', 'api_key', 'bearer', 'basic', 'none'])),
    scopes: z.array(z.string()).optional(),
    token_refresh: z.boolean().optional(),
    credentials_storage: z.enum(['env', 'vault', 'secret_manager', 'none']),
  }),

  // Rate limiting configuration
  rate_limits: z.object({
    requests_per_second: z.number().positive(),
    burst_size: z.number().positive(),
    quota_period: z.enum(['second', 'minute', 'hour', 'day']),
    quota_limit: z.number().positive().optional(),
    retry_after_header: z.boolean(),
  }),

  // Failure modes and recovery
  failure_modes: z.array(
    z.object({
      type: z.enum([
        'timeout',
        'rate_limit_exceeded',
        'auth_expired',
        'network_error',
        'service_unavailable',
        'validation_error',
        'permission_denied',
      ]),
      retryable: z.boolean(),
      retry_strategy: z.enum(['exponential_backoff', 'linear_backoff', 'fixed_delay', 'none']),
      max_retries: z.number().int().min(0).max(10),
      fallback_behavior: z.enum(['fail', 'queue', 'degrade', 'cache']),
      circuit_breaker: z.boolean(),
    })
  ),

  // Data handling
  data: z.object({
    input_schema: z.string().optional(),
    output_schema: z.string().optional(),
    max_payload_size: z.number().positive(),
    supported_formats: z.array(z.enum(['json', 'xml', 'csv', 'binary', 'multipart'])),
    compression: z.enum(['none', 'gzip', 'deflate', 'br']).optional(),
  }),

  // Integration requirements
  requirements: z.object({
    min_runner_version: z
      .string()
      .regex(/^\d+\.\d+\.\d+/)
      .optional(),
    required_features: z.array(z.string()).optional(),
    dependencies: z.array(z.string()).optional(),
    network_access: z.boolean(),
    sandboxed: z.boolean(),
  }),

  // Observability
  observability: z.object({
    metrics: z.boolean(),
    logs: z.boolean(),
    traces: z.boolean(),
    health_check: z.boolean(),
  }),

  // Compliance and security
  compliance: z.object({
    data_classification: z.enum(['public', 'internal', 'confidential', 'restricted']),
    pii_handling: z.boolean(),
    encryption_in_transit: z.boolean(),
    encryption_at_rest: z.boolean(),
    audit_logging: z.boolean(),
  }),

  // Contact and support
  support: z.object({
    owner_team: z.string().optional(),
    contact_email: z.string().email().optional(),
    sla_tier: z.enum(['none', 'best_effort', 'standard', 'premium']).optional(),
    issue_tracker: z.string().url().optional(),
  }),
})

export type ConnectorMetadata = z.infer<typeof ConnectorMetadataSchema>

// ============================================================================
// Registry Index Types
// ============================================================================

export interface ConnectorRegistryIndex {
  schema_version: string
  generated_at: string
  registry: {
    total_connectors: number
    by_status: Record<ConnectorStatus, number>
    by_maturity: Record<string, number>
  }
  connectors: Array<{
    id: string
    version: string
    status: ConnectorStatus
    maturity: string
    name: string
    supported_job_types: string[]
    auth_required: boolean
    rate_limited: boolean
    documentation_url?: string
  }>
  categories: Array<{
    name: string
    description: string
    connectors: string[]
  }>

  compatibility_matrix: Array<{
    connector_id: string
    runner_types: string[]
    min_runner_version?: string
    incompatible_with?: string[]
  }>
}

// ============================================================================
// Validation Functions
// ============================================================================

export function validateConnectorMetadata(metadata: unknown): {
  valid: boolean
  errors: string[]
  warnings: string[]
  normalized?: ConnectorMetadata
} {
  const errors: string[] = []
  const warnings: string[] = []

  const result = ConnectorMetadataSchema.safeParse(metadata)

  if (!result.success) {
    errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`))
    return { valid: false, errors, warnings }
  }

  const normalized = result.data

  // Semantic validation

  // Check status/maturity alignment
  if (normalized.status === 'stable' && normalized.maturity !== 'production') {
    warnings.push('Stable connectors should have production maturity')
  }

  if (normalized.status === 'experimental' && normalized.maturity === 'production') {
    errors.push('Experimental connectors cannot have production maturity')
  }

  // Check capability consistency
  if (normalized.capabilities.streaming && !normalized.capabilities.real_time) {
    warnings.push('Streaming connectors typically require real-time capability')
  }

  // Check rate limit sanity
  if (normalized.rate_limits.burst_size > normalized.rate_limits.requests_per_second * 10) {
    warnings.push('Burst size unusually large compared to requests_per_second')
  }

  // Check failure mode coverage
  const hasTimeout = normalized.failure_modes.some((f) => f.type === 'timeout')
  const hasRateLimit = normalized.failure_modes.some((f) => f.type === 'rate_limit_exceeded')

  if (!hasTimeout) {
    warnings.push('No timeout failure mode defined')
  }
  if (!hasRateLimit) {
    warnings.push('No rate_limit_exceeded failure mode defined')
  }

  // Check auth consistency
  if (normalized.auth.required && normalized.auth.methods.includes('none')) {
    errors.push('Auth required but "none" method listed')
  }

  if (!normalized.auth.required && normalized.auth.methods.length > 1) {
    warnings.push('Auth not required but multiple auth methods defined')
  }

  // Check observability minimums
  if (!normalized.observability.metrics && !normalized.observability.logs) {
    warnings.push('Connector should expose at least metrics or logs')
  }

  return { valid: errors.length === 0, errors, warnings, normalized }
}

// ============================================================================
// Registry Index Generator
// ============================================================================

export function generateRegistryIndex(
  connectors: ConnectorMetadata[],
  options?: {
    schemaVersion?: string
    categories?: Array<{ name: string; description: string; connectors: string[] }>
    compatibilityMatrix?: ConnectorRegistryIndex['compatibility_matrix']
  }
): ConnectorRegistryIndex {
  const byStatus: Record<ConnectorStatus, number> = {
    unsupported: 0,
    partial: 0,
    experimental: 0,
    beta: 0,
    stable: 0,
    deprecated: 0,
  }

  const byMaturity: Record<string, number> = {
    alpha: 0,
    beta: 0,
    production: 0,
  }

  for (const connector of connectors) {
    byStatus[connector.status]++
    byMaturity[connector.maturity]++
  }

  return {
    schema_version: options?.schemaVersion || '1.0.0',
    generated_at: new Date().toISOString(),
    registry: {
      total_connectors: connectors.length,
      by_status: byStatus,
      by_maturity: byMaturity,
    },
    connectors: connectors.map((c) => ({
      id: c.connector_id,
      version: c.version,
      status: c.status,
      maturity: c.maturity,
      name: c.name,
      supported_job_types: c.supported_job_types,
      auth_required: c.auth.required,
      rate_limited: c.rate_limits.requests_per_second < 1000, // Arbitrary threshold
      documentation_url: c.documentation_url,
    })),
    categories: options?.categories || [],
    compatibility_matrix: options?.compatibilityMatrix || [],
  }
}

// ============================================================================
// README Sync Generator
// ============================================================================

export function generateRegistryReadme(index: ConnectorRegistryIndex): string {
  const lines: string[] = []

  lines.push('# JobForge Connector Registry')
  lines.push('')
  lines.push(`**Generated:** ${index.generated_at}`)
  lines.push(`**Schema Version:** ${index.schema_version}`)
  lines.push('')

  lines.push('## Overview')
  lines.push('')
  lines.push(`Total Connectors: **${index.registry.total_connectors}**`)
  lines.push('')

  lines.push('### By Status')
  lines.push('')
  lines.push('| Status | Count | Description |')
  lines.push('|--------|-------|-------------|')

  const statusDescriptions: Record<ConnectorStatus, string> = {
    unsupported: 'Not implemented or maintained',
    partial: 'Partial implementation, some features missing',
    experimental: 'Early development, may change significantly',
    beta: 'Feature complete but not fully tested',
    stable: 'Production-ready with full support',
    deprecated: 'Scheduled for removal, migrate away',
  }

  for (const [status, count] of Object.entries(index.registry.by_status)) {
    if (count > 0) {
      lines.push(`| ${status} | ${count} | ${statusDescriptions[status as ConnectorStatus]} |`)
    }
  }
  lines.push('')

  lines.push('### By Maturity')
  lines.push('')
  lines.push('| Maturity | Count |')
  lines.push('|----------|-------|')
  for (const [maturity, count] of Object.entries(index.registry.by_maturity)) {
    if (count > 0) {
      lines.push(`| ${maturity} | ${count} |`)
    }
  }
  lines.push('')

  lines.push('## Connector Catalog')
  lines.push('')
  lines.push('| ID | Name | Status | Maturity | Auth | Rate Limited |')
  lines.push('|----|------|--------|----------|------|--------------|')

  for (const connector of index.connectors) {
    const authIcon = connector.auth_required ? '🔒' : '🔓'
    const rateIcon = connector.rate_limited ? '⚡' : '✓'
    lines.push(
      `| \`${connector.id}\` | ${connector.name} | ${connector.status} | ${connector.maturity} | ${authIcon} | ${rateIcon} |`
    )
  }
  lines.push('')

  if (index.categories.length > 0) {
    lines.push('## Categories')
    lines.push('')
    for (const category of index.categories) {
      lines.push(`### ${category.name}`)
      lines.push('')
      lines.push(category.description)
      lines.push('')
      lines.push('**Connectors:**')
      for (const connectorId of category.connectors) {
        lines.push(`- \`${connectorId}\``)
      }
      lines.push('')
    }
  }

  if (index.compatibility_matrix.length > 0) {
    lines.push('## Compatibility Matrix')
    lines.push('')
    lines.push('| Connector | Supported Runners | Min Version | Incompatible With |')
    lines.push('|-----------|-------------------|---------------|-------------------|')
    for (const compat of index.compatibility_matrix) {
      const runners = compat.runner_types.join(', ')
      const minVer = compat.min_runner_version || '-'
      const incompatible = compat.incompatible_with?.join(', ') || '-'
      lines.push(`| \`${compat.connector_id}\` | ${runners} | ${minVer} | ${incompatible} |`)
    }
    lines.push('')
  }

  lines.push('## Status Definitions')
  lines.push('')
  lines.push('- **unsupported**: Connector exists in documentation but has no implementation')
  lines.push('- **partial**: Implementation exists but key features are missing or broken')
  lines.push('- **experimental**: Early-stage implementation, APIs may change')
  lines.push('- **beta**: Feature-complete but undergoing testing')
  lines.push('- **stable**: Production-ready with backward compatibility guarantees')
  lines.push('- **deprecated**: Will be removed in a future version, migration required')
  lines.push('')

  lines.push('---')
  lines.push('*This registry is auto-generated from connector metadata definitions.*')
  lines.push('*Do not edit manually - changes will be overwritten.*')

  return lines.join('\n')
}

// ============================================================================
// Registry Loader and Validator
// ============================================================================

export interface RegistryLoadResult {
  success: boolean
  connectors: ConnectorMetadata[]
  errors: string[]
  warnings: string[]
  invalid_entries: string[]
}

export async function loadConnectorRegistry(registryPath: string): Promise<RegistryLoadResult> {
  const connectors: ConnectorMetadata[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const invalidEntries: string[] = []

  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    // Check if path exists
    try {
      await fs.access(registryPath)
    } catch {
      errors.push(`Registry path does not exist: ${registryPath}`)
      return { success: false, connectors, errors, warnings, invalid_entries: invalidEntries }
    }

    const entries = await fs.readdir(registryPath, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Look for metadata.json in subdirectory
        const metadataPath = path.join(registryPath, entry.name, 'metadata.json')
        try {
          const content = await fs.readFile(metadataPath, 'utf-8')
          const data = JSON.parse(content)

          const validation = validateConnectorMetadata(data)

          if (!validation.valid) {
            errors.push(
              `Invalid connector ${entry.name}:`,
              ...validation.errors.map((e) => `  - ${e}`)
            )
            invalidEntries.push(entry.name)
          } else {
            if (validation.warnings.length > 0) {
              warnings.push(
                `Warnings for ${entry.name}:`,
                ...validation.warnings.map((w) => `  - ${w}`)
              )
            }
            connectors.push(validation.normalized!)
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
            // No metadata.json, skip
            continue
          }
          errors.push(`Failed to load ${entry.name}: ${e}`)
          invalidEntries.push(entry.name)
        }
      }
    }
  } catch (error) {
    errors.push(`Failed to load registry: ${error}`)
  }

  return {
    success: errors.length === 0,
    connectors,
    errors,
    warnings,
    invalid_entries: invalidEntries,
  }
}

// ============================================================================
// Registry CLI
// ============================================================================

export async function validateRegistry(registryPath: string): Promise<{
  valid: boolean
  summary: string
  details: RegistryLoadResult
}> {
  const result = await loadConnectorRegistry(registryPath)

  const summary = `
Connector Registry Validation
=============================
Total Entries: ${result.connectors.length + result.invalid_entries.length}
Valid: ${result.connectors.length}
Invalid: ${result.invalid_entries.length}
Warnings: ${result.warnings.length}

${result.valid ? '✓ All connectors valid' : `✗ ${result.errors.length} error(s) found`}
${result.warnings.length > 0 ? `⚠ ${result.warnings.length} warning(s)` : ''}
`.trim()

  return {
    valid: result.success,
    summary,
    details: result,
  }
}

export async function generateRegistryFiles(
  registryPath: string,
  outputDir: string,
  options?: {
    categories?: Array<{ name: string; description: string; connectors: string[] }>
    compatibilityMatrix?: ConnectorRegistryIndex['compatibility_matrix']
  }
): Promise<{
  success: boolean
  files_written: string[]
  errors: string[]
}> {
  const filesWritten: string[] = []
  const errors: string[] = []

  try {
    const fs = await import('fs/promises')
    const path = await import('path')

    // Load registry
    const loadResult = await loadConnectorRegistry(registryPath)

    if (!loadResult.success) {
      return { success: false, files_written: [], errors: loadResult.errors }
    }

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true })

    // Generate index.json
    const index = generateRegistryIndex(loadResult.connectors, options)
    const indexPath = path.join(outputDir, 'index.json')
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2))
    filesWritten.push(indexPath)

    // Generate README.md
    const readme = generateRegistryReadme(index)
    const readmePath = path.join(outputDir, 'README.md')
    await fs.writeFile(readmePath, readme)
    filesWritten.push(readmePath)

    // Generate validation report
    const report = {
      timestamp: new Date().toISOString(),
      schema_version: index.schema_version,
      summary: {
        total: loadResult.connectors.length,
        valid: loadResult.connectors.length,
        invalid: loadResult.invalid_entries.length,
        warnings: loadResult.warnings.length,
      },
      warnings: loadResult.warnings,
      invalid_entries: loadResult.invalid_entries,
    }
    const reportPath = path.join(outputDir, 'validation-report.json')
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2))
    filesWritten.push(reportPath)
  } catch (error) {
    errors.push(`Failed to generate registry files: ${error}`)
  }

  return { success: errors.length === 0, files_written: filesWritten, errors }
}
