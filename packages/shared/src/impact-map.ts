/**
 * JobForge Impact Map (TruthCore-lite)
 *
 * Lightweight, deterministic impact mapper that builds an "assertion graph" from runs:
 * - nodes: event → bundle_run → child_run → artifacts
 * - edges: produced_by, triggered_by, depends_on
 * - Each node includes: tenant/project, timestamps, hashes, fingerprints
 *
 * Feature flag: JOBFORGE_IMPACT_MAP_ENABLED=1
 * Default: OFF
 *
 * Constraints:
 * - No ML or heavy graph DB
 * - Store as artifact JSON and optionally in DB
 * - Deterministic/stable hashes
 */

import { createHash } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { JOBFORGE_IMPACT_MAP_ENABLED } from './feature-flags.js'

// ============================================================================
// Types
// ============================================================================

export interface ImpactNode {
  id: string
  type: 'event' | 'bundle_run' | 'child_run' | 'artifact' | 'trigger'
  tenantId: string
  projectId?: string
  timestamp: string
  hash: string // Stable content hash
  fingerprint?: string // Environment/dependency fingerprint
  metadata: Record<string, unknown>
}

export interface ImpactEdge {
  id: string
  from: string
  to: string
  type: 'produced_by' | 'triggered_by' | 'depends_on' | 'parent_of' | 'references'
  timestamp: string
  metadata?: Record<string, unknown>
}

export interface ImpactGraph {
  version: string
  runId: string
  tenantId: string
  projectId?: string
  createdAt: string
  nodes: ImpactNode[]
  edges: ImpactEdge[]
  rootNodeId: string
}

export interface ImpactRunSummary {
  runId: string
  tenantId: string
  projectId?: string
  jobType: string
  status: string
  createdAt: string
  completedAt?: string
  inputHash: string
  manifestHash: string
  parentRunId?: string
  childRunIds: string[]
  artifacts: string[]
}

// ============================================================================
// Hashing Utilities (Stable & Deterministic)
// ============================================================================

/**
 * Create a stable hash from input data
 * Uses canonical JSON representation for consistency
 */
export function createStableHash(data: unknown): string {
  const canonical = canonicalize(data)
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Canonicalize data to stable JSON string
 * - Sorted keys
 * - No undefined values
 * - Consistent number formatting
 */
export function canonicalize(data: unknown): string {
  if (data === null) return 'null'
  if (data === undefined) return ''

  if (typeof data === 'string') return JSON.stringify(data)
  if (typeof data === 'number') return String(data)
  if (typeof data === 'boolean') return String(data)

  if (Array.isArray(data)) {
    const items = data.map(canonicalize).join(',')
    return `[${items}]`
  }

  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const pairs = keys
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`)
    return `{${pairs.join(',')}}`
  }

  return String(data)
}

/**
 * Create a content hash for a node
 */
export function createNodeHash(node: Omit<ImpactNode, 'hash'>): string {
  const { id, type, tenantId, projectId, timestamp, metadata } = node
  return createStableHash({ id, type, tenantId, projectId, timestamp, metadata })
}

// ============================================================================
// Impact Map Builder
// ============================================================================

export class ImpactMapBuilder {
  private nodes: Map<string, ImpactNode> = new Map()
  private edges: Map<string, ImpactEdge> = new Map()
  private runId: string
  private tenantId: string
  private projectId?: string

  constructor(runId: string, tenantId: string, projectId?: string) {
    this.runId = runId
    this.tenantId = tenantId
    this.projectId = projectId
  }

  /**
   * Add event node
   */
  addEvent(
    eventId: string,
    eventType: string,
    payload: Record<string, unknown>,
    options: {
      timestamp?: string
      sourceApp?: string
      actorId?: string
    } = {}
  ): ImpactNode {
    const timestamp = options.timestamp || new Date().toISOString()
    const hash = createStableHash({ eventId, eventType, payload, timestamp })

    const node: ImpactNode = {
      id: eventId,
      type: 'event',
      tenantId: this.tenantId,
      projectId: this.projectId,
      timestamp,
      hash,
      metadata: {
        eventType,
        payloadHash: createStableHash(payload),
        sourceApp: options.sourceApp || 'unknown',
        actorId: options.actorId,
      },
    }

    this.nodes.set(eventId, node)
    return node
  }

  /**
   * Add bundle run node
   */
  addBundleRun(
    runId: string,
    jobType: string,
    inputs: Record<string, unknown>,
    options: {
      timestamp?: string
      fingerprint?: string
      status?: string
    } = {}
  ): ImpactNode {
    const timestamp = options.timestamp || new Date().toISOString()
    const inputHash = createStableHash(inputs)

    const node: ImpactNode = {
      id: runId,
      type: 'bundle_run',
      tenantId: this.tenantId,
      projectId: this.projectId,
      timestamp,
      hash: inputHash,
      fingerprint: options.fingerprint,
      metadata: {
        jobType,
        inputHash,
        status: options.status || 'running',
      },
    }

    this.nodes.set(runId, node)
    return node
  }

  /**
   * Add child run node
   */
  addChildRun(
    childRunId: string,
    parentRunId: string,
    jobType: string,
    options: {
      timestamp?: string
      inputs?: Record<string, unknown>
    } = {}
  ): ImpactNode {
    const timestamp = options.timestamp || new Date().toISOString()
    const inputHash = options.inputs ? createStableHash(options.inputs) : 'no-inputs'

    const node: ImpactNode = {
      id: childRunId,
      type: 'child_run',
      tenantId: this.tenantId,
      projectId: this.projectId,
      timestamp,
      hash: inputHash,
      metadata: {
        jobType,
        parentRunId,
        inputHash,
      },
    }

    this.nodes.set(childRunId, node)

    // Add parent edge
    this.addEdge(childRunId, parentRunId, 'parent_of')

    return node
  }

  /**
   * Add artifact node
   */
  addArtifact(
    artifactId: string,
    runId: string,
    artifactType: string,
    content: unknown,
    options: {
      timestamp?: string
      ref?: string
      size?: number
    } = {}
  ): ImpactNode {
    const timestamp = options.timestamp || new Date().toISOString()
    const contentHash = createStableHash(content)

    const node: ImpactNode = {
      id: artifactId,
      type: 'artifact',
      tenantId: this.tenantId,
      projectId: this.projectId,
      timestamp,
      hash: contentHash,
      metadata: {
        artifactType,
        runId,
        ref: options.ref,
        size: options.size,
        contentHash,
      },
    }

    this.nodes.set(artifactId, node)

    // Add produced_by edge
    this.addEdge(artifactId, runId, 'produced_by')

    return node
  }

  /**
   * Add trigger node
   */
  addTrigger(
    triggerId: string,
    ruleId: string,
    eventId: string,
    options: {
      timestamp?: string
      decision?: string
      dryRun?: boolean
    } = {}
  ): ImpactNode {
    const timestamp = options.timestamp || new Date().toISOString()

    const node: ImpactNode = {
      id: triggerId,
      type: 'trigger',
      tenantId: this.tenantId,
      projectId: this.projectId,
      timestamp,
      hash: createStableHash({ triggerId, ruleId, eventId, decision: options.decision }),
      metadata: {
        ruleId,
        eventId,
        decision: options.decision || 'unknown',
        dryRun: options.dryRun ?? true,
      },
    }

    this.nodes.set(triggerId, node)

    // Add triggered_by edge
    this.addEdge(triggerId, eventId, 'triggered_by')

    return node
  }

  /**
   * Add edge between nodes
   */
  addEdge(from: string, to: string, type: ImpactEdge['type']): ImpactEdge {
    const edgeId = createStableHash({ from, to, type })
    const timestamp = new Date().toISOString()

    const edge: ImpactEdge = {
      id: edgeId,
      from,
      to,
      type,
      timestamp,
    }

    this.edges.set(edgeId, edge)
    return edge
  }

  /**
   * Connect event to bundle run
   */
  connectEventToRun(eventId: string, runId: string): void {
    this.addEdge(runId, eventId, 'triggered_by')
  }

  /**
   * Add dependency edge
   */
  addDependency(fromRunId: string, toRunId: string): void {
    this.addEdge(fromRunId, toRunId, 'depends_on')
  }

  /**
   * Build the impact graph
   */
  build(): ImpactGraph {
    // Ensure we have a root node
    const rootNodeId = this.runId

    // If runId is not a node yet, create a placeholder
    if (!this.nodes.has(rootNodeId)) {
      this.addBundleRun(rootNodeId, 'unknown', {})
    }

    // Sort nodes and edges deterministically
    const sortedNodes = Array.from(this.nodes.values()).sort((a, b) => a.id.localeCompare(b.id))
    const sortedEdges = Array.from(this.edges.values()).sort((a, b) => a.id.localeCompare(b.id))

    return {
      version: '1.0',
      runId: this.runId,
      tenantId: this.tenantId,
      projectId: this.projectId,
      createdAt: new Date().toISOString(),
      nodes: sortedNodes,
      edges: sortedEdges,
      rootNodeId,
    }
  }

  /**
   * Export graph to JSON
   */
  exportToJson(): string {
    return JSON.stringify(this.build(), null, 2)
  }

  /**
   * Export to compact format (for storage)
   */
  exportToCompactJson(): string {
    const graph = this.build()
    // Remove indentation for compact storage
    return JSON.stringify(graph)
  }

  /**
   * Calculate graph hash (for versioning/comparison)
   */
  calculateGraphHash(): string {
    const graph = this.build()
    // Hash only the structural elements
    const structuralData = {
      nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, hash: n.hash })),
      edges: graph.edges.map((e) => ({ from: e.from, to: e.to, type: e.type })),
    }
    return createStableHash(structuralData)
  }
}

// ============================================================================
// Impact Map Queries
// ============================================================================

export class ImpactMapQuery {
  private graph: ImpactGraph

  constructor(graph: ImpactGraph) {
    this.graph = graph
  }

  /**
   * Get node by ID
   */
  getNode(id: string): ImpactNode | undefined {
    return this.graph.nodes.find((n) => n.id === id)
  }

  /**
   * Get edges from a node
   */
  getEdgesFrom(nodeId: string): ImpactEdge[] {
    return this.graph.edges.filter((e) => e.from === nodeId)
  }

  /**
   * Get edges to a node
   */
  getEdgesTo(nodeId: string): ImpactEdge[] {
    return this.graph.edges.filter((e) => e.to === nodeId)
  }

  /**
   * Get children of a node (parent_of edges)
   */
  getChildren(nodeId: string): ImpactNode[] {
    const childIds = this.graph.edges
      .filter((e) => e.to === nodeId && e.type === 'parent_of')
      .map((e) => e.from)
    return this.graph.nodes.filter((n) => childIds.includes(n.id))
  }

  /**
   * Get parents of a node
   */
  getParents(nodeId: string): ImpactNode[] {
    const parentIds = this.graph.edges
      .filter((e) => e.from === nodeId && e.type === 'parent_of')
      .map((e) => e.to)
    return this.graph.nodes.filter((n) => parentIds.includes(n.id))
  }

  /**
   * Get artifacts produced by a run
   */
  getArtifacts(runId: string): ImpactNode[] {
    const artifactIds = this.graph.edges
      .filter((e) => e.to === runId && e.type === 'produced_by')
      .map((e) => e.from)
    return this.graph.nodes.filter((n) => artifactIds.includes(n.id) && n.type === 'artifact')
  }

  /**
   * Get triggering event for a run
   */
  getTriggeringEvent(runId: string): ImpactNode | undefined {
    const eventEdge = this.graph.edges.find((e) => e.from === runId && e.type === 'triggered_by')
    if (!eventEdge) return undefined
    return this.graph.nodes.find((n) => n.id === eventEdge.to)
  }

  /**
   * Get all runs that depend on a given run
   */
  getDependentRuns(runId: string): ImpactNode[] {
    const dependentIds = this.graph.edges
      .filter((e) => e.to === runId && e.type === 'depends_on')
      .map((e) => e.from)
    return this.graph.nodes.filter(
      (n) => dependentIds.includes(n.id) && (n.type === 'bundle_run' || n.type === 'child_run')
    )
  }

  /**
   * Build a tree representation of the impact graph
   */
  buildTree(rootId?: string): ImpactTreeNode {
    const root = rootId ? this.getNode(rootId) : this.getNode(this.graph.rootNodeId)
    if (!root) throw new Error('Root node not found')

    return this.buildTreeRecursive(root, new Set())
  }

  private buildTreeRecursive(node: ImpactNode, visited: Set<string>): ImpactTreeNode {
    if (visited.has(node.id)) {
      return {
        id: node.id,
        type: node.type,
        hash: node.hash,
        timestamp: node.timestamp,
        metadata: { ...node.metadata, cyclic: true },
        children: [],
      }
    }

    visited.add(node.id)

    // Get children edges
    const childEdges = this.graph.edges.filter((e) => e.to === node.id && e.type === 'parent_of')
    const children = childEdges
      .map((e) => this.getNode(e.from))
      .filter((n): n is ImpactNode => n !== undefined)
      .map((child) => this.buildTreeRecursive(child, new Set(visited)))

    // Get artifact edges
    const artifactEdges = this.graph.edges.filter(
      (e) => e.to === node.id && e.type === 'produced_by'
    )
    const artifacts = artifactEdges
      .map((e) => this.getNode(e.from))
      .filter((n): n is ImpactNode => n !== undefined && n.type === 'artifact')
      .map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        hash: artifact.hash,
        timestamp: artifact.timestamp,
        metadata: artifact.metadata,
        children: [],
      }))

    return {
      id: node.id,
      type: node.type,
      hash: node.hash,
      timestamp: node.timestamp,
      metadata: node.metadata,
      children: [...children, ...artifacts],
    }
  }

  /**
   * Find impact path from one node to another
   */
  findPath(fromId: string, toId: string): ImpactNode[] | null {
    const visited = new Set<string>()
    const path: ImpactNode[] = []

    const dfs = (currentId: string): boolean => {
      if (currentId === toId) return true
      if (visited.has(currentId)) return false

      visited.add(currentId)
      const node = this.getNode(currentId)
      if (!node) return false

      path.push(node)

      // Check all outgoing edges
      const outgoing = this.getEdgesFrom(currentId)
      for (const edge of outgoing) {
        if (dfs(edge.to)) return true
      }

      path.pop()
      return false
    }

    return dfs(fromId) ? path : null
  }
}

export interface ImpactTreeNode {
  id: string
  type: string
  hash: string
  timestamp: string
  metadata: Record<string, unknown>
  children: ImpactTreeNode[]
}

// ============================================================================
// Formatters
// ============================================================================

/**
 * Format impact graph as human-readable tree
 */
export function formatImpactTree(graph: ImpactGraph, rootId?: string): string {
  const query = new ImpactMapQuery(graph)
  const tree = query.buildTree(rootId)

  const lines: string[] = []
  lines.push(`Impact Map: ${graph.runId}`)
  lines.push(`Tenant: ${graph.tenantId}${graph.projectId ? ` / Project: ${graph.projectId}` : ''}`)
  lines.push(`Generated: ${graph.createdAt}`)
  lines.push('')

  lines.push('Dependency Tree:')
  lines.push('')
  formatTreeNode(tree, '', lines)

  return lines.join('\n')
}

function formatTreeNode(node: ImpactTreeNode, prefix: string, lines: string[]): void {
  const icon = getNodeIcon(node.type)
  const hashShort = node.hash.slice(0, 8)
  lines.push(`${prefix}${icon} ${node.id} [${hashShort}...]`)

  const childPrefix = prefix + '  '
  for (const child of node.children) {
    formatTreeNode(child, childPrefix, lines)
  }
}

function getNodeIcon(type: string): string {
  switch (type) {
    case 'event':
      return '⚡'
    case 'bundle_run':
      return '▶'
    case 'child_run':
      return '⏵'
    case 'artifact':
      return '📄'
    case 'trigger':
      return '🔔'
    default:
      return '•'
  }
}

/**
 * Format impact summary as JSON
 */
export function formatImpactSummary(graph: ImpactGraph): ImpactRunSummary {
  const query = new ImpactMapQuery(graph)
  const root = query.getNode(graph.rootNodeId)

  if (!root) {
    throw new Error('Root node not found')
  }

  const children = query.getChildren(graph.rootNodeId)
  const artifacts = query.getArtifacts(graph.rootNodeId)

  return {
    runId: graph.runId,
    tenantId: graph.tenantId,
    projectId: graph.projectId,
    jobType: (root.metadata.jobType as string) || 'unknown',
    status: (root.metadata.status as string) || 'unknown',
    createdAt: graph.createdAt,
    inputHash: (root.metadata.inputHash as string) || root.hash,
    manifestHash: graph.nodes.length > 0 ? createStableHash(graph.nodes.map((n) => n.hash)) : '',
    childRunIds: children.map((c) => c.id),
    artifacts: artifacts.map((a) => a.id),
  }
}

// ============================================================================
// Export Functions
// ============================================================================

/**
 * Export impact graph to file
 */
export async function exportImpactGraph(
  graph: ImpactGraph,
  outputDir: string = '.jobforge/impact'
): Promise<string> {
  await mkdir(outputDir, { recursive: true })

  const filename = `impact-${graph.runId}-${graph.createdAt.replace(/[:.]/g, '-')}.json`
  const filepath = join(outputDir, filename)

  await writeFile(filepath, JSON.stringify(graph, null, 2))

  return filepath
}

/**
 * Export impact tree to file
 */
export async function exportImpactTree(
  graph: ImpactGraph,
  outputDir: string = '.jobforge/impact'
): Promise<string> {
  await mkdir(outputDir, { recursive: true })

  const treeText = formatImpactTree(graph)
  const filename = `impact-tree-${graph.runId}.txt`
  const filepath = join(outputDir, filename)

  await writeFile(filepath, treeText)

  return filepath
}

/**
 * Parse impact graph from JSON
 */
export function parseImpactGraph(json: string): ImpactGraph {
  return JSON.parse(json) as ImpactGraph
}

// ============================================================================
// Integration Helpers
// ============================================================================

/**
 * Create impact map from bundle execution
 */
export function createImpactMapFromExecution(
  runId: string,
  tenantId: string,
  execution: {
    jobType: string
    inputs: Record<string, unknown>
    eventId?: string
    triggerId?: string
    artifacts?: Array<{ id: string; type: string; content: unknown }>
    childRuns?: Array<{ id: string; jobType: string }>
  },
  options: {
    projectId?: string
    fingerprint?: string
  } = {}
): ImpactGraph {
  if (!JOBFORGE_IMPACT_MAP_ENABLED) {
    // Return minimal graph when disabled
    return {
      version: '1.0',
      runId,
      tenantId,
      projectId: options.projectId,
      createdAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      rootNodeId: runId,
    }
  }

  const builder = new ImpactMapBuilder(runId, tenantId, options.projectId)

  // Add event if provided
  if (execution.eventId) {
    builder.addEvent(execution.eventId, 'execution_triggered', {}, {})
  }

  // Add main run
  builder.addBundleRun(runId, execution.jobType, execution.inputs, {
    fingerprint: options.fingerprint,
  })

  // Connect event to run
  if (execution.eventId) {
    builder.connectEventToRun(execution.eventId, runId)
  }

  // Add child runs
  if (execution.childRuns) {
    for (const child of execution.childRuns) {
      builder.addChildRun(child.id, runId, child.jobType)
    }
  }

  // Add artifacts
  if (execution.artifacts) {
    for (const artifact of execution.artifacts) {
      builder.addArtifact(artifact.id, runId, artifact.type, artifact.content)
    }
  }

  return builder.build()
}

/**
 * Compare two impact graphs for differences
 */
export function compareImpactGraphs(
  graphA: ImpactGraph,
  graphB: ImpactGraph
): {
  identical: boolean
  nodeDifferences: Array<{ id: string; hashA: string; hashB: string }>
  edgeDifferences: Array<{ type: string; inA: boolean; inB: boolean }>
} {
  const nodeAHashes = new Map(graphA.nodes.map((n) => [n.id, n.hash]))
  const nodeBHashes = new Map(graphB.nodes.map((n) => [n.id, n.hash]))

  const nodeDifferences: Array<{ id: string; hashA: string; hashB: string }> = []

  // Check all nodes in A
  for (const [id, hashA] of nodeAHashes) {
    const hashB = nodeBHashes.get(id)
    if (hashB !== hashA) {
      nodeDifferences.push({ id, hashA, hashB: hashB || 'missing' })
    }
  }

  // Check for nodes only in B
  for (const [id, hashB] of nodeBHashes) {
    if (!nodeAHashes.has(id)) {
      nodeDifferences.push({ id, hashA: 'missing', hashB })
    }
  }

  // Compare edges (simplified - just count by type)
  const edgeTypesA = countEdgeTypes(graphA.edges)
  const edgeTypesB = countEdgeTypes(graphB.edges)

  const edgeDifferences: Array<{ type: string; inA: boolean; inB: boolean }> = []
  const allTypes = new Set([...Object.keys(edgeTypesA), ...Object.keys(edgeTypesB)])

  for (const type of allTypes) {
    const countA = edgeTypesA[type] || 0
    const countB = edgeTypesB[type] || 0
    if (countA !== countB) {
      edgeDifferences.push({ type, inA: countA > 0, inB: countB > 0 })
    }
  }

  return {
    identical: nodeDifferences.length === 0 && edgeDifferences.length === 0,
    nodeDifferences,
    edgeDifferences,
  }
}

function countEdgeTypes(edges: ImpactEdge[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const edge of edges) {
    counts[edge.type] = (counts[edge.type] || 0) + 1
  }
  return counts
}
