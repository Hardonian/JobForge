/**
 * MCP Server Schemas
 * Zod schemas for all tool inputs/outputs
 */

import { z } from 'zod'

// ============================================================================
// Common Schemas
// ============================================================================

// Note: Use z.string().optional().default(crypto.randomUUID()) inline instead of shared schema
// zod .default() requires static values, not functions

export const tenantIdSchema = z.string().uuid('Tenant ID must be a valid UUID')

export const projectIdSchema = z.string().uuid().optional()

export const runIdSchema = z.string().uuid('Run ID must be a valid UUID')

export const jobTypeSchema = z.string().min(1, 'Job type is required')

export const jobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])

export const timestampSchema = z.string().datetime()

// ============================================================================
// Job Schemas
// ============================================================================

export const createJobInputSchema = z.object({
  jobType: jobTypeSchema,
  inputs: z.record(z.unknown()).default({} as Record<string, unknown>),
  tenantId: tenantIdSchema,
  projectId: projectIdSchema,
  traceId: z.string().min(1).optional(),
  idempotencyKey: z.string().optional(),
  priority: z.number().int().min(0).max(100).optional(),
  scheduledAt: timestampSchema.optional(),
})

export const createJobOutputSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  traceId: z.string(),
  dryRun: z.boolean(),
  timestamp: z.string().datetime(),
})

export const runJobInputSchema = z.object({
  jobType: jobTypeSchema,
  inputs: z.record(z.unknown()).default({} as Record<string, unknown>),
  tenantId: tenantIdSchema,
  projectId: projectIdSchema,
  traceId: z.string().min(1).optional(),
  waitForCompletion: z.boolean().default(false),
  timeoutMs: z.number().int().positive().optional(),
})

export const runJobOutputSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  traceId: z.string(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  result: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const getJobStatusInputSchema = z.object({
  runId: runIdSchema,
  tenantId: tenantIdSchema,
})

export const getJobStatusOutputSchema = z.object({
  runId: z.string().uuid(),
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const getJobLogsInputSchema = z.object({
  runId: runIdSchema,
  tenantId: tenantIdSchema,
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
})

export const getJobLogsOutputSchema = z.object({
  runId: z.string().uuid(),
  logs: z.array(
    z.object({
      timestamp: z.string().datetime(),
      level: z.enum(['debug', 'info', 'warn', 'error']),
      message: z.string(),
    })
  ),
  totalCount: z.number().int().nonnegative(),
})

export const cancelJobInputSchema = z.object({
  runId: runIdSchema,
  tenantId: tenantIdSchema,
  reason: z.string().optional(),
})

export const cancelJobOutputSchema = z.object({
  runId: z.string().uuid(),
  status: z.enum(['cancelled', 'completed', 'failed']),
  cancelledAt: z.string().datetime(),
  reason: z.string().optional(),
})

// ============================================================================
// Connector Schemas
// ============================================================================

export const listConnectorsInputSchema = z.object({
  tenantId: tenantIdSchema,
  projectId: projectIdSchema,
  includeInactive: z.boolean().default(false),
})

export const connectorInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  status: z.enum(['active', 'inactive', 'error']),
  capabilities: z.array(z.string()),
  lastTestedAt: z.string().datetime().optional(),
})

export const listConnectorsOutputSchema = z.object({
  connectors: z.array(connectorInfoSchema),
  totalCount: z.number().int().nonnegative(),
})

export const testConnectorInputSchema = z.object({
  connectorId: z.string(),
  tenantId: tenantIdSchema,
  testType: z.enum(['connectivity', 'full']).default('connectivity'),
})

export const testConnectorOutputSchema = z.object({
  connectorId: z.string(),
  success: z.boolean(),
  testedAt: z.string().datetime(),
  details: z.record(z.unknown()).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const getConnectorCapabilitiesInputSchema = z.object({
  connectorId: z.string(),
  tenantId: tenantIdSchema,
})

export const getConnectorCapabilitiesOutputSchema = z.object({
  connectorId: z.string(),
  capabilities: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      supported: z.boolean(),
    })
  ),
})

// ============================================================================
// Artifact Schemas
// ============================================================================

export const artifactInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  ref: z.string(),
  size: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  mimeType: z.string().optional(),
  createdAt: z.string().datetime(),
})

export const listArtifactsInputSchema = z.object({
  runId: runIdSchema.optional(),
  tenantId: tenantIdSchema,
  limit: z.number().int().positive().max(1000).default(100),
  offset: z.number().int().nonnegative().default(0),
})

export const listArtifactsOutputSchema = z.object({
  artifacts: z.array(artifactInfoSchema),
  totalCount: z.number().int().nonnegative(),
})

export const getArtifactInputSchema = z.object({
  artifactId: z.string(),
  tenantId: tenantIdSchema,
  includeContent: z.boolean().default(false),
})

export const getArtifactOutputSchema = z.object({
  artifact: artifactInfoSchema,
  content: z.string().optional(),
  downloadUrl: z.string().url().optional(),
})

export const putArtifactInputSchema = z.object({
  tenantId: tenantIdSchema,
  runId: runIdSchema.optional(),
  name: z.string().min(1),
  type: z.string(),
  ref: z.string(),
  size: z.number().int().positive().optional(),
  checksum: z.string().optional(),
  mimeType: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
})

export const putArtifactOutputSchema = z.object({
  artifactId: z.string(),
  registeredAt: z.string().datetime(),
  status: z.enum(['registered', 'failed']),
})

// ============================================================================
// ReadyLayer Schemas
// ============================================================================

export const verifyPackInputSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  pack: z.enum(['fast', 'full']).default('fast'),
  tenantId: tenantIdSchema,
  options: z
    .object({
      skipLint: z.boolean().optional(),
      skipTypecheck: z.boolean().optional(),
      skipBuild: z.boolean().optional(),
      skipTest: z.boolean().optional(),
      customCommands: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
    })
    .optional(),
})

export const verifyPackOutputSchema = z.object({
  status: z.enum(['pending', 'running', 'completed', 'failed']),
  runId: z.string().uuid(),
  traceId: z.string(),
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().optional(),
  logsRef: z.string().optional(),
  artifactsManifestRef: z.string().optional(),
  summary: z
    .object({
      totalCommands: z.number().int(),
      passed: z.number().int(),
      failed: z.number().int(),
      skipped: z.number().int(),
      durationMs: z.number().int(),
    })
    .optional(),
})

export const repoDiscoverInputSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  tenantId: tenantIdSchema,
})

export const repoDiscoverOutputSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  repoInfo: z
    .object({
      path: z.string(),
      packageManager: z.enum(['pnpm', 'npm', 'yarn']),
      hasLockfile: z.boolean(),
      availableScripts: z.array(z.string()),
      estimatedSize: z.number().int(),
    })
    .optional(),
})

export const policyCheckDiffInputSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  baseRef: z.string(),
  headRef: z.string(),
  tenantId: tenantIdSchema,
})

export const policyCheckDiffOutputSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  violations: z
    .array(
      z.object({
        file: z.string(),
        line: z.number().int(),
        severity: z.enum(['error', 'warning']),
        message: z.string(),
      })
    )
    .optional(),
})

export const securityDepsAuditInputSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  tenantId: tenantIdSchema,
  severity: z.enum(['low', 'moderate', 'high', 'critical']).default('moderate'),
})

export const securityDepsAuditOutputSchema = z.object({
  available: z.boolean(),
  reason: z.string().optional(),
  vulnerabilities: z
    .array(
      z.object({
        package: z.string(),
        severity: z.enum(['low', 'moderate', 'high', 'critical']),
        advisory: z.string(),
      })
    )
    .optional(),
})

// ============================================================================
// PR Schemas (Write Operations - Disabled by Default)
// ============================================================================

export const proposePatchsetInputSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  issueDescription: z.string(),
  constraints: z
    .object({
      maxFiles: z.number().int().positive().default(10),
      maxLinesChanged: z.number().int().positive().default(500),
      verifyPack: z.enum(['fast', 'full', 'none']).default('fast'),
    })
    .optional(),
  tenantId: tenantIdSchema,
  projectId: projectIdSchema,
  traceId: z.string().min(1).optional(),
})

export const proposePatchsetOutputSchema = z.object({
  patchsetRef: z.string(),
  report: z.object({
    description: z.string(),
    files: z.array(z.string()),
    estimatedImpact: z.enum(['low', 'medium', 'high']),
    suggestedVerifyPack: z.enum(['fast', 'full']),
  }),
  status: z.enum(['proposed', 'failed']),
  proposedAt: z.string().datetime(),
})

export const applyPatchsetInputSchema = z.object({
  patchsetRef: z.string(),
  tenantId: tenantIdSchema,
  policyToken: z.string(),
  dryRun: z.boolean().default(true),
})

export const applyPatchsetOutputSchema = z.object({
  patchsetRef: z.string(),
  applied: z.boolean(),
  dryRun: z.boolean(),
  filesChanged: z.array(z.string()),
  appliedAt: z.string().datetime().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const openPRInputSchema = z.object({
  repoRef: z.string(),
  patchsetRef: z.string(),
  title: z.string(),
  description: z.string(),
  tenantId: tenantIdSchema,
  projectId: projectIdSchema,
  policyToken: z.string(),
  baseBranch: z.string().default('main'),
})

export const openPROutputSchema = z.object({
  prUrl: z.string().url(),
  prNumber: z.number().int(),
  status: z.enum(['open', 'failed']),
  openedAt: z.string().datetime(),
})
