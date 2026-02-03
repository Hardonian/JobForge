/**
 * Connector and Error Envelope Contract Fixtures
 */

export const validConnectorFixture = {
  connector_id: 'github-connector',
  connector_type: 'source',
  name: 'GitHub Connector',
  description: 'Connects to GitHub API to fetch repository data',
  version: '1.2.0',
  supported_job_types: ['github.scan', 'github.sync', 'github.webhook'],
  required_scopes: ['github:read', 'github:webhook'],
  required_capabilities: ['network_access', 'secret_injection'],
  config_schema: {
    type: 'object',
    properties: {
      api_token: { type: 'string' },
      organization: { type: 'string' },
    },
    required: ['api_token'],
  },
  enabled: true,
}

export const validDestinationConnector = {
  connector_id: 'slack-connector',
  connector_type: 'destination',
  name: 'Slack Connector',
  description: 'Sends notifications to Slack channels',
  version: '2.0.1',
  supported_job_types: ['slack.notify', 'slack.alert'],
  required_scopes: ['slack:post'],
  required_capabilities: ['network_access'],
  config_schema: {
    type: 'object',
    properties: {
      webhook_url: { type: 'string' },
      channel: { type: 'string' },
    },
    required: ['webhook_url'],
  },
  enabled: true,
}

export const validTransformConnector = {
  connector_id: 'json-transform',
  connector_type: 'transform',
  name: 'JSON Transform',
  description: 'Transforms data between JSON formats',
  version: '1.0.0',
  supported_job_types: ['transform.json', 'transform.filter'],
  required_scopes: [],
  required_capabilities: [],
  enabled: true,
}

export const invalidConnectorMissingVersion = {
  connector_id: 'test-connector',
  connector_type: 'utility',
  name: 'Test Connector',
  // Missing version
  supported_job_types: ['test.job'],
  enabled: true,
}

export const invalidConnectorBadType = {
  connector_id: 'bad-connector',
  connector_type: 'invalid_type', // Invalid type
  name: 'Bad Connector',
  version: '1.0.0',
  supported_job_types: ['test.job'],
  enabled: true,
}

export const validRunnerCapabilities = {
  runner_id: 'local-runner-001',
  runner_type: 'local',
  version: '1.5.0',
  supported_connectors: ['github-connector', 'slack-connector', 'json-transform'],
  max_concurrent_jobs: 5,
  resource_limits: {
    cpu_cores: 4,
    memory_mb: 8192,
    disk_mb: 51200,
  },
  features: ['streaming_logs', 'artifact_upload', 'secret_injection', 'network_access'],
  enabled: true,
}

export const validDockerRunner = {
  runner_id: 'docker-runner-prod',
  runner_type: 'docker',
  version: '2.1.0',
  supported_connectors: ['github-connector', 'slack-connector'],
  max_concurrent_jobs: 10,
  resource_limits: {
    cpu_cores: 8,
    memory_mb: 16384,
    disk_mb: 102400,
  },
  features: [
    'streaming_logs',
    'artifact_upload',
    'artifact_download',
    'secret_injection',
    'env_var_injection',
    'network_access',
  ],
  enabled: true,
}

export const invalidRunnerMissingId = {
  // Missing runner_id
  runner_type: 'local',
  version: '1.0.0',
  supported_connectors: [],
  enabled: true,
}

export const invalidRunnerBadType = {
  runner_id: 'bad-runner',
  runner_type: 'vm', // Invalid type
  version: '1.0.0',
  supported_connectors: ['test'],
  enabled: true,
}

export const validErrorEnvelope = {
  code: 'VALIDATION_ERROR',
  message: 'The request payload failed validation',
  correlationId: 'corr-12345',
  details: [
    { field: 'tenant_id', message: 'Must be a valid UUID', code: 'invalid_uuid' },
    { field: 'payload', message: 'Required field missing', code: 'required' },
  ],
  timestamp: new Date().toISOString(),
}

export const validSimpleError = {
  code: 'NOT_FOUND',
  message: 'Resource not found',
  timestamp: new Date().toISOString(),
}

export const validErrorWithRecordDetails = {
  code: 'INTERNAL_ERROR',
  message: 'An unexpected error occurred',
  correlationId: 'corr-67890',
  details: {
    service: 'database',
    operation: 'query',
    retryable: false,
  },
  timestamp: new Date().toISOString(),
}

export const invalidErrorMissingCode = {
  message: 'Something went wrong',
  timestamp: new Date().toISOString(),
  // Missing code
}

export const invalidErrorBadCode = {
  code: 'SOME_RANDOM_ERROR', // Invalid error code
  message: 'Unknown error',
  timestamp: new Date().toISOString(),
}

export const invalidErrorMissingMessage = {
  code: 'BAD_REQUEST',
  timestamp: new Date().toISOString(),
  // Missing message
}

export const validHandshakeRequest = {
  schema_version: '1.0.0',
  instance_id: 'jobforge-instance-001',
  instance_type: 'jobforge',
  version: '1.5.0',
  connectors: [validConnectorFixture, validDestinationConnector],
  runner_capabilities: validRunnerCapabilities,
  metadata: {
    region: 'us-east-1',
    environment: 'production',
  },
  timestamp: new Date().toISOString(),
}

export const validHandshakeResponse = {
  schema_version: '1.0.0',
  handshake_id: 'handshake-abc123',
  status: 'accepted',
  accepted_connectors: ['github-connector', 'slack-connector'],
  rejected_connectors: [],
  runner_validation: {
    valid: true,
    missing_capabilities: [],
    warnings: [],
  },
  control_plane_version: '2.0.0',
  timestamp: new Date().toISOString(),
}

export const partialHandshakeResponse = {
  schema_version: '1.0.0',
  handshake_id: 'handshake-def456',
  status: 'partial',
  accepted_connectors: ['github-connector'],
  rejected_connectors: [{ connector_id: 'slack-connector', reason: 'Unsupported connector type' }],
  runner_validation: {
    valid: true,
    missing_capabilities: [],
    warnings: ['Some features may be limited'],
  },
  control_plane_version: '2.0.0',
  timestamp: new Date().toISOString(),
}

export const invalidHandshakeRequest = {
  schema_version: '0.9.0', // Wrong version
  instance_id: 'test-instance',
  instance_type: 'jobforge',
  version: '1.0.0',
  connectors: [], // Empty connectors array
  runner_capabilities: validRunnerCapabilities,
  timestamp: new Date().toISOString(),
}
