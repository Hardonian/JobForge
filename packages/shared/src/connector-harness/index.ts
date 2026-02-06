/**
 * Connector Harness - Barrel Export
 *
 * Canonical connector interface, evidence builder, and runner.
 */

// Types and schemas
export {
  ConnectorConfigSchema,
  ConnectorInputSchema,
  ConnectorContextSchema,
  EvidencePacketSchema,
  ConnectorResultSchema,
  ConnectorManifestSchema,
  SECRET_DENYLIST,
  EVIDENCE_ALLOWLIST,
  type ConnectorConfig,
  type ConnectorInput,
  type ConnectorContext,
  type EvidencePacket,
  type ConnectorResult,
  type ConnectorManifest,
  type ConnectorFn,
  type RunConnectorParams,
} from './types.js'

// Evidence builder
export {
  EvidenceBuilder,
  redactFields,
  hashOutput,
  scanForSecrets,
  type EvidenceBuilderOptions,
} from './evidence.js'

// Runner
export {
  runConnector,
  ConnectorValidationError,
  ConnectorTimeoutError,
} from './runner.js'

// Harness (test utilities)
export {
  ConnectorHarness,
  createTestFixture,
  type HarnessOptions,
  type HarnessFixture,
  type SimulatedFailure,
} from './harness.js'
