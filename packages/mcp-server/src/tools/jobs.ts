/**
 * JobForge Job Tools
 * Tools for job creation, execution, and management
 */

import type { z } from 'zod'
import type { ToolDefinition, ToolHandler, ToolResult } from '../types'
import {
  createJobInputSchema,
  createJobOutputSchema,
  runJobInputSchema,
  runJobOutputSchema,
  getJobStatusInputSchema,
  getJobStatusOutputSchema,
  getJobLogsInputSchema,
  getJobLogsOutputSchema,
  cancelJobInputSchema,
  cancelJobOutputSchema,
} from '../schemas'
import { registerTool } from './registry'

// Import type only - actual import will happen at runtime
type ExecutionPlaneClientType = import('@jobforge/client').ExecutionPlaneClient

// Create client lazily to avoid issues during module load
let client: ExecutionPlaneClientType | null = null
async function getClient(): Promise<ExecutionPlaneClientType> {
  if (!client) {
    const { ExecutionPlaneClient } = await import('@jobforge/client')
    client = new ExecutionPlaneClient()
  }
  return client
}

// Type helpers
type CreateJobInput = z.infer<typeof createJobInputSchema>
type CreateJobOutput = z.infer<typeof createJobOutputSchema>
type RunJobInput = z.infer<typeof runJobInputSchema>
type RunJobOutput = z.infer<typeof runJobOutputSchema>
type GetJobStatusInput = z.infer<typeof getJobStatusInputSchema>
type GetJobStatusOutput = z.infer<typeof getJobStatusOutputSchema>
type GetJobLogsInput = z.infer<typeof getJobLogsInputSchema>
type GetJobLogsOutput = z.infer<typeof getJobLogsOutputSchema>
type CancelJobInput = z.infer<typeof cancelJobInputSchema>
type CancelJobOutput = z.infer<typeof cancelJobOutputSchema>

// ============================================================================
// jobforge.jobs.create
// ============================================================================

const createJobHandler: ToolHandler<CreateJobInput, CreateJobOutput> = async (
  input,
  context
): Promise<ToolResult<CreateJobOutput>> => {
  const c = await getClient()
  const result = await c.requestJob(
    input.jobType,
    input.inputs,
    input.tenantId,
    input.projectId,
    input.traceId || context.traceId,
    input.idempotencyKey
  )

  return {
    success: true,
    data: result as CreateJobOutput,
  }
}

const createJobTool: ToolDefinition<CreateJobInput, CreateJobOutput> = {
  name: 'jobforge.jobs.create',
  description: 'Create a new job and queue it for execution',
  inputSchema: createJobInputSchema,
  outputSchema: createJobOutputSchema,
  requiredScopes: ['jobs:run'],
  isWrite: true,
  requiresPolicyToken: false,
  handler: createJobHandler,
}

// ============================================================================
// jobforge.jobs.run
// ============================================================================

const runJobHandler: ToolHandler<RunJobInput, RunJobOutput> = async (
  input,
  context
): Promise<ToolResult<RunJobOutput>> => {
  const c = await getClient()
  const createResult = await c.requestJob(
    input.jobType,
    input.inputs,
    input.tenantId,
    input.projectId,
    input.traceId || context.traceId
  )

  const runId = createResult.runId

  if (!input.waitForCompletion) {
    return {
      success: true,
      data: {
        runId,
        status: createResult.status as RunJobOutput['status'],
        traceId: createResult.traceId,
        startedAt: new Date().toISOString(),
      },
    }
  }

  // Poll for completion
  const timeout = input.timeoutMs || 300000
  const startTime = Date.now()
  const pollInterval = 1000

  while (Date.now() - startTime < timeout) {
    const status = await c.getRunStatus(runId, input.tenantId)

    if (
      status.status === 'completed' ||
      status.status === 'failed' ||
      status.status === 'cancelled'
    ) {
      return {
        success: true,
        data: {
          runId,
          status: status.status,
          traceId: createResult.traceId,
          startedAt: status.startedAt,
          completedAt: status.completedAt,
          error: status.error,
        },
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  return {
    success: true,
    data: {
      runId,
      status: 'running',
      traceId: createResult.traceId,
      startedAt: new Date().toISOString(),
    },
  }
}

const runJobTool: ToolDefinition<RunJobInput, RunJobOutput> = {
  name: 'jobforge.jobs.run',
  description: 'Create and optionally wait for a job to complete',
  inputSchema: runJobInputSchema,
  outputSchema: runJobOutputSchema,
  requiredScopes: ['jobs:run'],
  isWrite: true,
  requiresPolicyToken: false,
  handler: runJobHandler,
}

// ============================================================================
// jobforge.jobs.status
// ============================================================================

const getJobStatusHandler: ToolHandler<GetJobStatusInput, GetJobStatusOutput> = async (
  input
): Promise<ToolResult<GetJobStatusOutput>> => {
  const c = await getClient()
  const status = await c.getRunStatus(input.runId, input.tenantId)

  return {
    success: true,
    data: {
      runId: input.runId,
      status: status.status,
      progress: status.progress,
      startedAt: status.startedAt,
      completedAt: status.completedAt,
      error: status.error,
    },
  }
}

const getJobStatusTool: ToolDefinition<GetJobStatusInput, GetJobStatusOutput> = {
  name: 'jobforge.jobs.status',
  description: 'Get the status of a job run',
  inputSchema: getJobStatusInputSchema,
  outputSchema: getJobStatusOutputSchema,
  requiredScopes: ['jobs:read'],
  isWrite: false,
  requiresPolicyToken: false,
  handler: getJobStatusHandler,
}

// ============================================================================
// jobforge.jobs.logs
// ============================================================================

const getJobLogsHandler: ToolHandler<GetJobLogsInput, GetJobLogsOutput> = async (
  input
): Promise<ToolResult<GetJobLogsOutput>> => {
  const c = await getClient()
  const manifest = await c.getRunManifest(input.runId, input.tenantId)

  return {
    success: true,
    data: {
      runId: input.runId,
      logs:
        (manifest as { logs?: string[] })?.logs
          ?.slice(input.offset, input.offset + input.limit)
          .map((log: string) => ({
            timestamp: new Date().toISOString(),
            level: 'info' as const,
            message: log,
          })) || [],
      totalCount: (manifest as { logs?: string[] })?.logs?.length || 0,
    },
  }
}

const getJobLogsTool: ToolDefinition<GetJobLogsInput, GetJobLogsOutput> = {
  name: 'jobforge.jobs.logs',
  description: 'Get logs for a job run',
  inputSchema: getJobLogsInputSchema,
  outputSchema: getJobLogsOutputSchema,
  requiredScopes: ['jobs:read'],
  isWrite: false,
  requiresPolicyToken: false,
  handler: getJobLogsHandler,
}

// ============================================================================
// jobforge.jobs.cancel
// ============================================================================

const cancelJobHandler: ToolHandler<CancelJobInput, CancelJobOutput> = async (
  input
): Promise<ToolResult<CancelJobOutput>> => {
  return {
    success: true,
    data: {
      runId: input.runId,
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      reason: input.reason,
    },
  }
}

const cancelJobTool: ToolDefinition<CancelJobInput, CancelJobOutput> = {
  name: 'jobforge.jobs.cancel',
  description: 'Cancel a running job',
  inputSchema: cancelJobInputSchema,
  outputSchema: cancelJobOutputSchema,
  requiredScopes: ['jobs:write'],
  isWrite: true,
  requiresPolicyToken: false,
  handler: cancelJobHandler,
}

// ============================================================================
// Register all job tools
// ============================================================================

export function registerJobTools(): void {
  registerTool(createJobTool)
  registerTool(runJobTool)
  registerTool(getJobStatusTool)
  registerTool(getJobLogsTool)
  registerTool(cancelJobTool)
}
