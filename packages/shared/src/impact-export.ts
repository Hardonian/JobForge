/**
 * JobForge Impact Graph Export (bundle runs)
 * Deterministic, redacted impact graph for bundle execution analysis.
 */

import { createStableHash } from './impact-map.js'
import type { ArtifactOutput } from './execution-plane/manifests.js'

export type ImpactNodeType = 'event' | 'bundle_run' | 'module_run' | 'child_run' | 'artifact'
export type ImpactEdgeType = 'triggered_by' | 'produced_by' | 'depends_on'

export interface ImpactExportNode {
  id: string
  type: ImpactNodeType
  tenant_id: string
  project_id?: string
  trace_id?: string
  hash: string
  metadata: Record<string, unknown>
}

export interface ImpactExportEdge {
  id: string
  from: string
  to: string
  type: ImpactEdgeType
  hash: string
  metadata?: Record<string, unknown>
}

export interface ImpactExportGraph {
  schema_version: '1.0'
  run_id: string
  tenant_id: string
  project_id?: string
  trace_id?: string
  nodes: ImpactExportNode[]
  edges: ImpactExportEdge[]
}

export interface ImpactBundleRunSnapshot {
  run_id: string
  tenant_id: string
  project_id?: string
  trace_id?: string
  bundle_run: {
    job_type: string
    status?: string
    created_at?: string
    mode?: string
  }
  event?: {
    id?: string
    type?: string
    created_at?: string
    source_app?: string
    actor_id?: string
    payload?: Record<string, unknown>
  }
  request_bundle?: {
    bundle_id?: string
    trace_id?: string
    metadata?: Record<string, unknown>
    requests: Array<{
      id: string
      job_type: string
      tenant_id?: string
      project_id?: string
      payload?: Record<string, unknown>
      idempotency_key?: string
      required_scopes?: string[]
      is_action_job?: boolean
    }>
  }
  child_runs?: Array<{
    request_id: string
    job_type?: string
    status?: string
    job_id?: string
    reason?: string
  }>
  artifacts?: Array<ArtifactOutput & { run_id?: string }>
}

export interface ImpactExportTreeNode {
  node: ImpactExportNode
  children: ImpactExportTreeNode[]
}

const SECRET_KEYS = ['token', 'password', 'secret', 'key', 'credential', 'auth']

function redactImpactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactImpactSecrets(item))
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const redacted: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(obj)) {
      const isSecret = SECRET_KEYS.some((secret) => key.toLowerCase().includes(secret))
      if (isSecret && typeof entry === 'string') {
        redacted[key] = entry.length > 8 ? `${entry.slice(0, 4)}****${entry.slice(-4)}` : '****'
      } else {
        redacted[key] = redactImpactSecrets(entry)
      }
    }
    return redacted
  }

  return value
}

function normalizeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return redactImpactSecrets(metadata) as Record<string, unknown>
}

function createBundleRequestHash(
  bundle: ImpactBundleRunSnapshot['request_bundle']
): string | undefined {
  if (!bundle || !Array.isArray(bundle.requests)) return undefined
  const normalized = {
    ...bundle,
    requests: [...bundle.requests].sort((a, b) => a.id.localeCompare(b.id)),
  }
  return createStableHash(redactImpactSecrets(normalized))
}

function createNodeHash(node: Omit<ImpactExportNode, 'hash'>): string {
  const { id, type, tenant_id, project_id, trace_id, metadata } = node
  return createStableHash({
    id,
    type,
    tenant_id,
    project_id: project_id || null,
    trace_id: trace_id || null,
    metadata,
  })
}

function createEdgeHash(
  edge: Pick<ImpactExportEdge, 'from' | 'to' | 'type' | 'metadata'>
): string {
  const { from, to, type, metadata } = edge
  return createStableHash({ from, to, type, metadata: metadata || null })
}

function buildNode(
  base: Omit<ImpactExportNode, 'hash' | 'metadata'> & { metadata: Record<string, unknown> }
): ImpactExportNode {
  const metadata = normalizeMetadata(base.metadata)
  const node: Omit<ImpactExportNode, 'hash'> = {
    ...base,
    metadata,
  }
  return {
    ...node,
    hash: createNodeHash(node),
  }
}

function buildEdge(
  base: Omit<ImpactExportEdge, 'hash' | 'id'> & { metadata?: Record<string, unknown> }
): ImpactExportEdge {
  const metadata = base.metadata ? normalizeMetadata(base.metadata) : undefined
  const edge: Omit<ImpactExportEdge, 'hash' | 'id'> = {
    ...base,
    metadata,
  }
  const hash = createEdgeHash(edge)
  return {
    ...edge,
    id: hash,
    hash,
  }
}

function sortNodes(nodes: ImpactExportNode[]): ImpactExportNode[] {
  return nodes.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type)
    if (typeOrder !== 0) return typeOrder
    return a.id.localeCompare(b.id)
  })
}

function sortEdges(edges: ImpactExportEdge[]): ImpactExportEdge[] {
  return edges.sort((a, b) => {
    const typeOrder = a.type.localeCompare(b.type)
    if (typeOrder !== 0) return typeOrder
    const fromOrder = a.from.localeCompare(b.from)
    if (fromOrder !== 0) return fromOrder
    const toOrder = a.to.localeCompare(b.to)
    if (toOrder !== 0) return toOrder
    return a.id.localeCompare(b.id)
  })
}

export function buildImpactGraphFromBundleRun(snapshot: ImpactBundleRunSnapshot): ImpactExportGraph {
  const nodes = new Map<string, ImpactExportNode>()
  const edges = new Map<string, ImpactExportEdge>()

  const addNode = (node: ImpactExportNode): void => {
    nodes.set(node.id, node)
  }

  const addEdge = (edge: ImpactExportEdge): void => {
    edges.set(edge.id, edge)
  }

  const eventId = snapshot.event?.id || snapshot.trace_id
  if (eventId) {
    addNode(
      buildNode({
        id: eventId,
        type: 'event',
        tenant_id: snapshot.tenant_id,
        project_id: snapshot.project_id,
        trace_id: snapshot.trace_id,
        metadata: {
          event_type: snapshot.event?.type || 'bundle_request',
          created_at: snapshot.event?.created_at,
          source_app: snapshot.event?.source_app,
          actor_id: snapshot.event?.actor_id,
          payload_hash: snapshot.event?.payload
            ? createStableHash(redactImpactSecrets(snapshot.event.payload))
            : undefined,
        },
      })
    )
  }

  const bundleMetadata: Record<string, unknown> = {
    job_type: snapshot.bundle_run.job_type,
    status: snapshot.bundle_run.status,
    created_at: snapshot.bundle_run.created_at,
    mode: snapshot.bundle_run.mode,
    bundle_id: snapshot.request_bundle?.bundle_id,
    request_count: snapshot.request_bundle?.requests.length || 0,
    child_run_count: snapshot.child_runs?.length || 0,
  }

  if (snapshot.request_bundle) {
    bundleMetadata.request_bundle_hash = createBundleRequestHash(snapshot.request_bundle)
  }

  addNode(
    buildNode({
      id: snapshot.run_id,
      type: 'bundle_run',
      tenant_id: snapshot.tenant_id,
      project_id: snapshot.project_id,
      trace_id: snapshot.trace_id,
      metadata: bundleMetadata,
    })
  )

  if (eventId) {
    addEdge(
      buildEdge({
        from: snapshot.run_id,
        to: eventId,
        type: 'triggered_by',
      })
    )
  }

  const moduleRunIds = new Map<string, string>()

  for (const request of snapshot.request_bundle?.requests || []) {
    const moduleNode = buildNode({
      id: request.id,
      type: 'module_run',
      tenant_id: snapshot.tenant_id,
      project_id: snapshot.project_id,
      trace_id: snapshot.trace_id,
      metadata: {
        job_type: request.job_type,
        request_id: request.id,
        idempotency_key: request.idempotency_key,
        required_scopes: request.required_scopes,
        is_action_job: request.is_action_job,
        payload_hash: request.payload
          ? createStableHash(redactImpactSecrets(request.payload))
          : undefined,
      },
    })
    addNode(moduleNode)
    moduleRunIds.set(request.id, moduleNode.id)

    addEdge(
      buildEdge({
        from: moduleNode.id,
        to: snapshot.run_id,
        type: 'depends_on',
      })
    )
  }

  for (const child of snapshot.child_runs || []) {
    const childId = child.job_id || `child-${child.request_id}`
    const childNode = buildNode({
      id: childId,
      type: 'child_run',
      tenant_id: snapshot.tenant_id,
      project_id: snapshot.project_id,
      trace_id: snapshot.trace_id,
      metadata: {
        request_id: child.request_id,
        job_type: child.job_type,
        status: child.status,
        reason: child.reason,
      },
    })
    addNode(childNode)

    const parentModuleId = moduleRunIds.get(child.request_id)
    addEdge(
      buildEdge({
        from: childNode.id,
        to: parentModuleId || snapshot.run_id,
        type: 'depends_on',
      })
    )
  }

  for (const artifact of snapshot.artifacts || []) {
    const artifactId = artifact.ref || artifact.name
    const artifactNode = buildNode({
      id: artifactId,
      type: 'artifact',
      tenant_id: snapshot.tenant_id,
      project_id: snapshot.project_id,
      trace_id: snapshot.trace_id,
      metadata: {
        name: artifact.name,
        type: artifact.type,
        ref: artifact.ref,
        size: artifact.size,
        mime_type: artifact.mime_type,
      },
    })
    addNode(artifactNode)

    const producedBy = artifact.run_id || snapshot.run_id
    addEdge(
      buildEdge({
        from: artifactNode.id,
        to: producedBy,
        type: 'produced_by',
      })
    )
  }

  const sortedNodes = sortNodes(Array.from(nodes.values()))
  const sortedEdges = sortEdges(Array.from(edges.values()))

  return {
    schema_version: '1.0',
    run_id: snapshot.run_id,
    tenant_id: snapshot.tenant_id,
    project_id: snapshot.project_id,
    trace_id: snapshot.trace_id,
    nodes: sortedNodes,
    edges: sortedEdges,
  }
}

export function buildImpactExportTree(graph: ImpactExportGraph): ImpactExportTreeNode {
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]))
  const childrenMap = new Map<string, string[]>()

  const addChild = (parentId: string, childId: string): void => {
    const children = childrenMap.get(parentId) || []
    children.push(childId)
    childrenMap.set(parentId, children)
  }

  for (const edge of graph.edges) {
    if (edge.type === 'triggered_by') {
      addChild(edge.to, edge.from)
    } else if (edge.type === 'depends_on') {
      addChild(edge.to, edge.from)
    } else if (edge.type === 'produced_by') {
      addChild(edge.to, edge.from)
    }
  }

  const root =
    graph.nodes.find((node) => node.type === 'event') ||
    graph.nodes.find((node) => node.type === 'bundle_run')

  if (!root) {
    throw new Error('Impact graph root node not found')
  }

  const buildNodeTree = (nodeId: string, visited: Set<string>): ImpactExportTreeNode => {
    const node = nodeMap.get(nodeId)
    if (!node) {
      throw new Error(`Missing node ${nodeId}`)
    }

    if (visited.has(nodeId)) {
      return { node, children: [] }
    }

    const nextVisited = new Set(visited)
    nextVisited.add(nodeId)

    const childIds = (childrenMap.get(nodeId) || []).slice().sort((a, b) => {
      const nodeA = nodeMap.get(a)
      const nodeB = nodeMap.get(b)
      if (!nodeA || !nodeB) return a.localeCompare(b)
      const typeOrder = nodeA.type.localeCompare(nodeB.type)
      if (typeOrder !== 0) return typeOrder
      return nodeA.id.localeCompare(nodeB.id)
    })

    return {
      node,
      children: childIds.map((childId) => buildNodeTree(childId, nextVisited)),
    }
  }

  return buildNodeTree(root.id, new Set())
}

export function formatImpactExportTree(graph: ImpactExportGraph): string {
  const tree = buildImpactExportTree(graph)
  const lines: string[] = []

  lines.push(`Impact Graph: ${graph.run_id}`)
  lines.push(`Tenant: ${graph.tenant_id}${graph.project_id ? ` / Project: ${graph.project_id}` : ''}`)
  if (graph.trace_id) {
    lines.push(`Trace: ${graph.trace_id}`)
  }
  lines.push('')
  lines.push('Tree:')
  lines.push('')

  const formatNode = (node: ImpactExportTreeNode, prefix: string): void => {
    const label = `${getNodeIcon(node.node.type)} ${node.node.type} ${node.node.id}`
    lines.push(`${prefix}${label}`)
    const nextPrefix = `${prefix}  `
    for (const child of node.children) {
      formatNode(child, nextPrefix)
    }
  }

  formatNode(tree, '')
  return lines.join('\n')
}

function getNodeIcon(type: ImpactNodeType): string {
  switch (type) {
    case 'event':
      return '⚡'
    case 'bundle_run':
      return '▶'
    case 'module_run':
      return '▣'
    case 'child_run':
      return '⏵'
    case 'artifact':
      return '📄'
    default:
      return '•'
  }
}
