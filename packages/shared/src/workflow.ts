/**
 * JobForge Workflow Engine (DAG Orchestrator)
 * Chains interdependent tasks, passing parent outputs to child inputs.
 */

import { z } from 'zod'

export const WorkflowNodeSchema = z.object({
  id: z.string().min(1),
  job_type: z.string().min(1),
  inputs: z.record(z.unknown()),
  depends_on: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  timeout_ms: z.number().int().default(300000),
})

export const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  nodes: z.array(WorkflowNodeSchema).min(1),
})

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>

export interface WorkflowExecutionState {
  workflow_name: string
  tenant_id: string
  completed_nodes: Map<string, { job_id: string; output: Record<string, unknown> }>
  pending_nodes: Set<string>
  running_nodes: Set<string>
  failed_nodes: Set<string>
}

/**
 * Validates whether a workflow DAG is acyclic (contains no loops).
 */
export function validateWorkflowAcyclic(workflow: WorkflowDefinition): {
  valid: boolean
  error?: string
} {
  const nodeMap = new Map(workflow.nodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function hasCycle(nodeId: string): boolean {
    if (visiting.has(nodeId)) return true
    if (visited.has(nodeId)) return false

    visiting.add(nodeId)
    const node = nodeMap.get(nodeId)
    if (node) {
      for (const depId of node.depends_on) {
        if (!nodeMap.has(depId)) {
          throw new Error(`Node ${nodeId} depends on non-existent node ${depId}`)
        }
        if (hasCycle(depId)) return true
      }
    }
    visiting.delete(nodeId)
    visited.add(nodeId)
    return false
  }

  try {
    for (const node of workflow.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycle(node.id)) {
          return { valid: false, error: `Cyclic dependency detected at node ${node.id}` }
        }
      }
    }
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Returns nodes whose dependencies are completely satisfied.
 */
export function getReadyNodes(
  workflow: WorkflowDefinition,
  completedNodeIds: Set<string>,
  activeNodeIds: Set<string>
): WorkflowNode[] {
  return workflow.nodes.filter((node) => {
    if (completedNodeIds.has(node.id) || activeNodeIds.has(node.id)) return false
    return node.depends_on.every((depId) => completedNodeIds.has(depId))
  })
}

/**
 * Executes a workflow DAG in dependency order
 */
export async function executeWorkflowDAG(
  workflow: WorkflowDefinition,
  executor: (
    node: WorkflowNode,
    resolvedInputs: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
): Promise<Map<string, Record<string, unknown>>> {
  const validation = validateWorkflowAcyclic(workflow)
  if (!validation.valid) {
    throw new Error(`Invalid workflow DAG: ${validation.error}`)
  }

  const completed = new Map<string, Record<string, unknown>>()
  const completedIds = new Set<string>()
  const activeIds = new Set<string>()

  while (completedIds.size < workflow.nodes.length) {
    const ready = getReadyNodes(workflow, completedIds, activeIds)
    if (ready.length === 0 && activeIds.size === 0) {
      throw new Error('Workflow deadlock or unresolvable dependencies detected')
    }

    // Execute all currently ready nodes in parallel
    const promises = ready.map(async (node) => {
      activeIds.add(node.id)
      try {
        // Resolve inputs with parent outputs
        const resolvedInputs = { ...node.inputs }
        for (const depId of node.depends_on) {
          const depOutput = completed.get(depId)
          if (depOutput) {
            resolvedInputs[`dep_${depId}`] = depOutput
          }
        }

        const result = await executor(node, resolvedInputs)
        completed.set(node.id, result)
        completedIds.add(node.id)
      } finally {
        activeIds.delete(node.id)
      }
    })

    await Promise.all(promises)
  }

  return completed
}
