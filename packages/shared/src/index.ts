/**
 * @jobforge/shared - Common types and utilities
 */

export * from './types.js'
export * from './schemas.js'
export * from './constants.js'
export * from './event-triggers.js'
export * from './feature-flags.js'
export * from './execution-plane/index.js'
export * from './execution-plane/schemas.js'
export * from './security.js'
export * from './trigger-safety.js'
export * from './replay.js'
export * from './verify-pack.js'
export * from './contract-tests.js'
export * from './replay-bundles.js'
export * from './policy-tokens.js'
export * from './registry-handshake.js'

// Solo-Founder Accelerator Layer
export * from './doctor.js'
export * from './policy-guard.js'
export * from './impact-map.js'
export * from './upgrade-lane.js'

// Explicit re-exports to resolve ambiguities
export type { TriggerType } from './execution-plane/triggers.js'
export {
  buildImpactGraphFromBundleRun,
  buildImpactExportTree,
  formatImpactExportTree,
  type ImpactBundleRunSnapshot,
  type ImpactExportEdge,
  type ImpactExportGraph,
  type ImpactExportNode,
  type ImpactExportTreeNode,
  type ImpactEdgeType,
  type ImpactNodeType,
} from './impact-export.js'
