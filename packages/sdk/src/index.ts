/**
 * @jobforge/sdk - Universal JobForge SDK
 *
 * Stable import surface for JobForge connectors and clients.
 */

// Re-export everything from sdk-ts and shared
export * from '@jobforge/sdk-ts'
export * from '@jobforge/shared'

// Re-export connector harness and registry from shared
export {
  // Connector Harness - Types and Schemas
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
  // Evidence Builder
  EvidenceBuilder,
  redactFields,
  hashOutput,
  scanForSecrets,
  type EvidenceBuilderOptions,
  // Runner
  runConnector,
  ConnectorValidationError,
  ConnectorTimeoutError,
  // Harness (test utilities)
  ConnectorHarness,
  createTestFixture,
  type HarnessOptions,
  type HarnessFixture,
  type SimulatedFailure,
} from '@jobforge/shared'

// Re-export connector registry
export {
  CONNECTOR_STATUS,
  type ConnectorStatus,
  ConnectorMetadataSchema,
  type ConnectorMetadata,
  type ConnectorRegistryIndex,
  validateConnectorMetadata,
  generateRegistryIndex,
  generateRegistryReadme,
  loadConnectorRegistry,
  validateRegistry,
  generateRegistryFiles,
} from '@jobforge/shared'
