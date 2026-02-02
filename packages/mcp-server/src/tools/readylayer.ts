/**
 * ReadyLayer Tools
 * Tools for ReadyLayer governance plane
 */

import type { z } from 'zod'
import type { ToolDefinition, ToolHandler, ToolResult } from '../types'
import {
  verifyPackInputSchema,
  verifyPackOutputSchema,
  repoDiscoverInputSchema,
  repoDiscoverOutputSchema,
  policyCheckDiffInputSchema,
  policyCheckDiffOutputSchema,
  securityDepsAuditInputSchema,
  securityDepsAuditOutputSchema,
  proposePatchsetInputSchema,
  proposePatchsetOutputSchema,
  applyPatchsetInputSchema,
  applyPatchsetOutputSchema,
  openPRInputSchema,
  openPROutputSchema,
} from '../schemas'
import { registerTool } from './registry'
import { MCP_PR_ENABLED } from '../feature-flags'
import { ExecutionPlaneClient } from '@jobforge/client'

type VerifyPackInput = z.infer<typeof verifyPackInputSchema>
type VerifyPackOutput = z.infer<typeof verifyPackOutputSchema>
type RepoDiscoverInput = z.infer<typeof repoDiscoverInputSchema>
type RepoDiscoverOutput = z.infer<typeof repoDiscoverOutputSchema>
type PolicyCheckDiffInput = z.infer<typeof policyCheckDiffInputSchema>
type PolicyCheckDiffOutput = z.infer<typeof policyCheckDiffOutputSchema>
type SecurityDepsAuditInput = z.infer<typeof securityDepsAuditInputSchema>
type SecurityDepsAuditOutput = z.infer<typeof securityDepsAuditOutputSchema>
type ProposePatchsetInput = z.infer<typeof proposePatchsetInputSchema>
type ProposePatchsetOutput = z.infer<typeof proposePatchsetOutputSchema>
type ApplyPatchsetInput = z.infer<typeof applyPatchsetInputSchema>
type ApplyPatchsetOutput = z.infer<typeof applyPatchsetOutputSchema>
type OpenPRInput = z.infer<typeof openPRInputSchema>
type OpenPROutput = z.infer<typeof openPROutputSchema>

// ============================================================================
// readylayer.quality.verify - Stage 3 Implementation
// ============================================================================

const verifyPackHandler: ToolHandler<VerifyPackInput, VerifyPackOutput> = async (
  input,
  context
): Promise<ToolResult<VerifyPackOutput>> => {
  // Create client to schedule verification job
  const client = new ExecutionPlaneClient()

  // Schedule verification pack as a job
  const jobResult = await client.requestJob(
    'readylayer.verify_pack',
    {
      repoPath: input.repoPath,
      repoRef: input.repoRef,
      pack: input.pack,
      options: input.options,
    },
    input.tenantId,
    undefined,
    context.traceId
  )

  return {
    success: true,
    data: {
      status: 'pending',
      runId: jobResult.runId,
      traceId: jobResult.traceId,
      startedAt: new Date().toISOString(),
    },
  }
}

const verifyPackTool: ToolDefinition<VerifyPackInput, VerifyPackOutput> = {
  name: 'readylayer.quality.verify',
  description: 'Run verification pack (lint, typecheck, build, test) via JobForge',
  inputSchema: verifyPackInputSchema,
  outputSchema: verifyPackOutputSchema,
  requiredScopes: ['readylayer:verify'],
  isWrite: true,
  requiresPolicyToken: false,
  handler: verifyPackHandler,
}

// ============================================================================
// readylayer.repo.discover
// ============================================================================

const repoDiscoverHandler: ToolHandler<RepoDiscoverInput, RepoDiscoverOutput> = async (
  _input
): Promise<ToolResult<RepoDiscoverOutput>> => {
  return {
    success: true,
    data: {
      available: false,
      reason: 'Repository discovery not yet implemented',
    },
  }
}

const repoDiscoverTool: ToolDefinition<RepoDiscoverInput, RepoDiscoverOutput> = {
  name: 'readylayer.repo.discover',
  description: 'Discover repository structure and capabilities',
  inputSchema: repoDiscoverInputSchema,
  outputSchema: repoDiscoverOutputSchema,
  requiredScopes: ['readylayer:read'],
  isWrite: false,
  requiresPolicyToken: false,
  handler: repoDiscoverHandler,
}

// ============================================================================
// readylayer.policy.check_diff
// ============================================================================

const policyCheckDiffHandler: ToolHandler<PolicyCheckDiffInput, PolicyCheckDiffOutput> = async (
  _input
): Promise<ToolResult<PolicyCheckDiffOutput>> => {
  return {
    success: true,
    data: {
      available: false,
      reason: 'Policy checking not yet implemented',
    },
  }
}

const policyCheckDiffTool: ToolDefinition<PolicyCheckDiffInput, PolicyCheckDiffOutput> = {
  name: 'readylayer.policy.check_diff',
  description: 'Check policy compliance of a diff',
  inputSchema: policyCheckDiffInputSchema,
  outputSchema: policyCheckDiffOutputSchema,
  requiredScopes: ['readylayer:read'],
  isWrite: false,
  requiresPolicyToken: false,
  handler: policyCheckDiffHandler,
}

// ============================================================================
// readylayer.security.deps_audit
// ============================================================================

const securityDepsAuditHandler: ToolHandler<
  SecurityDepsAuditInput,
  SecurityDepsAuditOutput
> = async (_input): Promise<ToolResult<SecurityDepsAuditOutput>> => {
  return {
    success: true,
    data: {
      available: false,
      reason: 'Security dependency audit not yet implemented',
    },
  }
}

const securityDepsAuditTool: ToolDefinition<SecurityDepsAuditInput, SecurityDepsAuditOutput> = {
  name: 'readylayer.security.deps_audit',
  description: 'Audit dependencies for security vulnerabilities',
  inputSchema: securityDepsAuditInputSchema,
  outputSchema: securityDepsAuditOutputSchema,
  requiredScopes: ['readylayer:read'],
  isWrite: false,
  requiresPolicyToken: false,
  handler: securityDepsAuditHandler,
}

// ============================================================================
// readylayer.pr.propose_patchset (Read-only)
// ============================================================================

const proposePatchsetHandler: ToolHandler<ProposePatchsetInput, ProposePatchsetOutput> = async (
  input
): Promise<ToolResult<ProposePatchsetOutput>> => {
  // Generate a patchset reference
  const patchsetRef = `ps_${crypto.randomUUID()}`

  return {
    success: true,
    data: {
      patchsetRef,
      report: {
        description: `Proposed patchset for: ${input.issueDescription.substring(0, 100)}...`,
        files: [],
        estimatedImpact: 'low',
        suggestedVerifyPack:
          (input.constraints?.verifyPack === 'none' ? 'fast' : input.constraints?.verifyPack) ||
          'fast',
      },
      status: 'proposed',
      proposedAt: new Date().toISOString(),
    },
  }
}

const proposePatchsetTool: ToolDefinition<ProposePatchsetInput, ProposePatchsetOutput> = {
  name: 'readylayer.pr.propose_patchset',
  description: 'Propose a patchset (read-only, does not apply changes)',
  inputSchema: proposePatchsetInputSchema,
  outputSchema: proposePatchsetOutputSchema,
  requiredScopes: ['readylayer:write'],
  isWrite: false, // Read-only operation
  requiresPolicyToken: false,
  handler: proposePatchsetHandler,
}

// ============================================================================
// readylayer.pr.apply_patchset (Write - Requires PR_ENABLED)
// ============================================================================

const applyPatchsetHandler: ToolHandler<ApplyPatchsetInput, ApplyPatchsetOutput> = async (
  input
): Promise<ToolResult<ApplyPatchsetOutput>> => {
  if (!MCP_PR_ENABLED) {
    return {
      success: false,
      error: {
        code: 'PR_DISABLED',
        message: 'PR operations are disabled. Set MCP_PR_ENABLED=1 to enable.',
      },
    }
  }

  if (input.dryRun) {
    return {
      success: true,
      data: {
        patchsetRef: input.patchsetRef,
        applied: false,
        dryRun: true,
        filesChanged: [],
      },
    }
  }

  // Real application would apply patchset here
  return {
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Patchset application not yet implemented (dryRun=true would simulate)',
    },
  }
}

const applyPatchsetTool: ToolDefinition<ApplyPatchsetInput, ApplyPatchsetOutput> = {
  name: 'readylayer.pr.apply_patchset',
  description: 'Apply a proposed patchset (requires policy token and MCP_PR_ENABLED)',
  inputSchema: applyPatchsetInputSchema,
  outputSchema: applyPatchsetOutputSchema,
  requiredScopes: ['readylayer:write'],
  isWrite: true,
  requiresPolicyToken: true,
  rateLimit: { max: 2, windowMs: 300000 }, // 5 min window
  handler: applyPatchsetHandler,
}

// ============================================================================
// readylayer.pr.open (Write - Requires PR_ENABLED)
// ============================================================================

const openPRHandler: ToolHandler<OpenPRInput, OpenPROutput> = async (
  _input
): Promise<ToolResult<OpenPROutput>> => {
  if (!MCP_PR_ENABLED) {
    return {
      success: false,
      error: {
        code: 'PR_DISABLED',
        message: 'PR operations are disabled. Set MCP_PR_ENABLED=1 to enable.',
      },
    }
  }

  return {
    success: false,
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'PR opening not yet implemented',
    },
  }
}

const openPRTool: ToolDefinition<OpenPRInput, OpenPROutput> = {
  name: 'readylayer.pr.open',
  description: 'Open a pull request (requires policy token and MCP_PR_ENABLED)',
  inputSchema: openPRInputSchema,
  outputSchema: openPROutputSchema,
  requiredScopes: ['readylayer:write'],
  isWrite: true,
  requiresPolicyToken: true,
  rateLimit: { max: 1, windowMs: 600000 }, // 10 min window
  handler: openPRHandler,
}

// ============================================================================
// Register all ReadyLayer tools
// ============================================================================

export function registerReadyLayerTools(): void {
  registerTool(verifyPackTool)
  registerTool(repoDiscoverTool)
  registerTool(policyCheckDiffTool)
  registerTool(securityDepsAuditTool)
  registerTool(proposePatchsetTool)
  registerTool(applyPatchsetTool)
  registerTool(openPRTool)
}
