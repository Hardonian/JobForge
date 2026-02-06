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

// Invocation determinism - selective exports to avoid conflicts with replay.js
export {
  // Unique functions and classes
  isInvocationDeterminismEnabled,
  isStrictDeterminismMode,
  DecisionTraceLogger,
  DeterminismEnforcer,
  captureInvocationIO,
  createInvocationSnapshot,
  verifyInvocationDeterminism,
  withDeterminismSpan,
  DecisionTraceBuilder,
  InMemoryInvocationManager,
  // Canonicalization (unique signature)
  canonicalizeJson,
  hashCanonicalJson,
  // Input snapshot with unique signature (aliased to avoid conflict)
  createInputSnapshot as createInvocationInputSnapshot,
  verifyInputHash as verifyInvocationInputHash,
  // Output artifact
  createOutputArtifact,
  verifyOutputHash,
  // Validation and reporting
  validateInvocationRecord,
  generateDeterminismReport,
  formatDeterminismReport,
  // Constants
  DEFAULT_IO_CAPTURE_CONFIG,
  // Schemas
  DecisionStepSchema,
  DecisionTraceSchema,
  InputSnapshotSchema,
  OutputArtifactSchema,
  InvocationContextSchema,
  InvocationRecordSchema,
  // Types
  type IOCaptureConfig,
  type CapturedIO,
  type DecisionTrace,
  type InvocationSnapshot,
  type DeterminismCheck,
  type InvocationDeterminismReport,
  type DeterminismViolation,
  type DeterminismEnforcementOptions,
  type InvocationContext,
  type InputSnapshotLegacy,
  type DecisionStep,
  type DecisionTraceLegacy,
  type OutputArtifact,
  type InvocationRecord,
  type DeterminismValidation,
  type DeterminismReport,
  type InvocationRecordManager,
  type ReplayResult as InvocationReplayResult,
  type CreateInputSnapshotOptions,
  type CreateOutputArtifactOptions,
} from './invocation-determinism.js'

// Connector Harness & SDK Safety
export * from './connector-harness/index.js'

// Solo-Founder Accelerator Layer
export * from './doctor.js'
export * from './policy-guard.js'
export * from './impact-map.js'
export * from './upgrade-lane.js'

// Explicit re-exports to resolve ambiguities
export type { TriggerType } from './execution-plane/triggers.js'
