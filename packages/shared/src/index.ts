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

// Runner & Connector Contract Enforcement (Release Hardening)
export * from './runner-contract-enforcement.js'
export * from './connector-registry.js'
// Invocation determinism exports are namespaced to avoid conflicts with replay.js
export {
  // Types
  type InvocationContext,
  type DecisionStep,
  type DecisionTrace,
  type OutputArtifact,
  type InvocationRecord,
  type DeterminismValidation,
  type DeterminismReport,
  type InvocationRecordManager,
  type ReplayResult,
  // Classes
  DecisionTraceBuilder,
  InMemoryInvocationManager,
  // Functions
  canonicalizeJson,
  hashCanonicalJson,
  createInputSnapshot as createInvocationInputSnapshot,
  verifyInputHash as verifyInvocationInputHash,
  createOutputArtifact,
  verifyOutputHash,
  validateInvocationRecord,
  generateDeterminismReport,
  formatDeterminismReport,
  // Schemas
  DecisionStepSchema,
  DecisionTraceSchema,
  InputSnapshotSchema,
  OutputArtifactSchema,
  InvocationContextSchema,
  InvocationRecordSchema,
} from './invocation-determinism.js'

// Solo-Founder Accelerator Layer
export * from './doctor.js'
export * from './policy-guard.js'
export * from './impact-map.js'
export * from './upgrade-lane.js'

// Explicit re-exports to resolve ambiguities
export type { TriggerType } from './execution-plane/triggers.js'
