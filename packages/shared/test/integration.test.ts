/**
 * Integration Tests for JobForge Bundle Triggers, Policy Tokens, and Replay System
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest'
import {
  // Policy tokens
  generatePolicyToken,
  verifyPolicyToken,
  validatePolicyTokenForAction,
  isTokenExpired,
  getTokenTimeRemaining,
  // Bundle triggers
  createTriggerRule,
  listTriggerRules,
  getTriggerRule,
  evaluateTriggers,
  clearTriggerStorage,
  // Replay bundles
  createReplayBundle,
  convertReplayToBundle,
  parseReplayBundle,
  type JobReplayBundle,
  // Contract tests
  validateBundle,
  simulateExecutorValidation,
} from '../src/index.js'

// Test constants
const TEST_TENANT_ID = '550e8400-e29b-41d4-a716-446655440000'
const TEST_PROJECT_ID = '550e8400-e29b-41d4-a716-446655440001'
const TEST_SECRET = 'test-secret-key-for-hmac-signing-32bytes!'

describe('Policy Token System', () => {
  describe('Token Generation', () => {
    it('should generate a valid policy token', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
          resource: 'recommendation-001',
          expiresInSeconds: 3600,
        },
        TEST_SECRET
      )

      expect(token).toBeDefined()
      expect(token).toContain('.')
      expect(token.length).toBeGreaterThan(100)
    })

    it('should generate unique tokens each time', () => {
      const token1 = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const token2 = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      expect(token1).not.toBe(token2)
    })
  })

  describe('Token Verification', () => {
    it('should verify a valid token successfully', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, TEST_SECRET)

      expect(result.valid).toBe(true)
      expect(result.token).toBeDefined()
      expect(result.claims?.tenantId).toBe(TEST_TENANT_ID)
      expect(result.claims?.action).toBe('autopilot.ops.apply')
      expect(result.claims?.scopes).toContain('ops:write')
    })

    it('should reject token with invalid signature', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, 'wrong-secret')

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Invalid signature')
    })

    it('should reject expired token', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
          expiresInSeconds: -100, // Expired 100 seconds ago (beyond clock skew tolerance)
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, TEST_SECRET)

      expect(result.valid).toBe(false)
      expect(result.error).toContain('expired')
    })

    it('should enforce required action', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, TEST_SECRET, {
        requiredAction: 'autopilot.ops.scan', // Different action
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('action mismatch')
    })

    it('should enforce required scopes', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:read'], // Missing write scope
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, TEST_SECRET, {
        requiredScopes: ['ops:write'],
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('Missing required scopes')
    })

    it('should enforce tenant match', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const result = verifyPolicyToken(token, TEST_SECRET, {
        requiredTenantId: 'different-tenant-id',
      })

      expect(result.valid).toBe(false)
      expect(result.error).toContain('tenant mismatch')
    })
  })

  describe('Action Job Validation', () => {
    it('should validate policy token for action jobs', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'autopilot.ops.apply',
          scopes: ['ops:write'],
        },
        TEST_SECRET
      )

      const result = validatePolicyTokenForAction(token, {
        secret: TEST_SECRET,
        requiredAction: 'autopilot.ops.apply',
        requiredScopes: ['ops:write'],
        requiredTenantId: TEST_TENANT_ID,
      })

      expect(result.valid).toBe(true)
      expect(result.claims).toBeDefined()
    })

    it('should reject missing token', () => {
      const result = validatePolicyTokenForAction(undefined, {
        secret: TEST_SECRET,
        requiredAction: 'autopilot.ops.apply',
      })

      expect(result.valid).toBe(false)
      expect(result.reason).toContain('required')
    })
  })

  describe('Token Utilities', () => {
    it('should check token expiration', () => {
      const expiredToken = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'test',
          scopes: ['test'],
          expiresInSeconds: -100, // Expired 100 seconds ago (beyond 60s clock skew)
        },
        TEST_SECRET
      )

      expect(isTokenExpired(expiredToken)).toBe(true)
    })

    it('should get remaining time for valid token', () => {
      const token = generatePolicyToken(
        {
          tenantId: TEST_TENANT_ID,
          actorId: 'user-123',
          action: 'test',
          scopes: ['test'],
          expiresInSeconds: 3600,
        },
        TEST_SECRET
      )

      const remaining = getTokenTimeRemaining(token)
      expect(remaining).toBeGreaterThan(3500)
      expect(remaining).toBeLessThanOrEqual(3600)
    })
  })
})

describe('Bundle Trigger System', () => {
  beforeEach(() => {
    clearTriggerStorage()
  })

  describe('Trigger Rule CRUD', () => {
    it('should create a trigger rule', () => {
      const rule = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Test Trigger',
        enabled: true,
        match: {
          event_type_allowlist: ['infrastructure.alert'],
        },
        action: {
          bundle_source: 'inline',
          bundle_builder: 'autopilot.ops.scan',
          mode: 'dry_run',
        },
        safety: {
          cooldown_seconds: 60,
          max_runs_per_hour: 10,
          allow_action_jobs: false,
        },
      })

      expect(rule.rule_id).toBeDefined()
      expect(rule.tenant_id).toBe(TEST_TENANT_ID)
      expect(rule.name).toBe('Test Trigger')
      expect(rule.enabled).toBe(true)
      expect(rule.match.event_type_allowlist).toContain('infrastructure.alert')
    })

    it('should list trigger rules for tenant', () => {
      createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Trigger 1',
        match: { event_type_allowlist: ['test.event'] },
        action: { bundle_source: 'inline', mode: 'dry_run' },
      })

      createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Trigger 2',
        match: { event_type_allowlist: ['test.event'] },
        action: { bundle_source: 'inline', mode: 'dry_run' },
      })

      const rules = listTriggerRules(TEST_TENANT_ID)

      expect(rules.length).toBe(2)
      expect(rules[0].name).toBe('Trigger 1')
      expect(rules[1].name).toBe('Trigger 2')
    })

    it('should get a trigger rule by ID', () => {
      const created = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Test Trigger',
        match: { event_type_allowlist: ['test.event'] },
        action: { bundle_source: 'inline', mode: 'dry_run' },
      })

      const fetched = getTriggerRule(created.rule_id)

      expect(fetched).toBeDefined()
      expect(fetched?.rule_id).toBe(created.rule_id)
      expect(fetched?.name).toBe('Test Trigger')
    })

    it('should return undefined for non-existent rule', () => {
      const fetched = getTriggerRule('non-existent-id')
      expect(fetched).toBeUndefined()
    })
  })

  describe('Trigger Evaluation', () => {
    it('should match event type', () => {
      const rule = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Test Trigger',
        enabled: true,
        match: {
          event_type_allowlist: ['infrastructure.alert'],
        },
        action: {
          bundle_source: 'inline',
          mode: 'dry_run',
        },
      })

      const event = {
        schema_version: '1.0.0',
        event_version: '1.0' as const,
        event_type: 'infrastructure.alert',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-001',
        tenant_id: TEST_TENANT_ID,
        source_app: 'jobforge' as const,
        payload: {},
        contains_pii: false,
      }

      const report = evaluateTriggers(event, [rule], { bundleTriggersEnabled: true })

      expect(report.rules_matched).toBe(1)
      expect(report.results[0].matched).toBe(true)
      expect(report.results[0].decision).toBe('fire')
    })

    it('should skip disabled rules', () => {
      const rule = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Disabled Trigger',
        enabled: false,
        match: {
          event_type_allowlist: ['test.event'],
        },
        action: {
          bundle_source: 'inline',
          mode: 'dry_run',
        },
      })

      const event = {
        schema_version: '1.0.0',
        event_version: '1.0' as const,
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-001',
        tenant_id: TEST_TENANT_ID,
        source_app: 'jobforge' as const,
        payload: {},
        contains_pii: false,
      }

      const report = evaluateTriggers(event, [rule], { bundleTriggersEnabled: true })

      expect(report.rules_matched).toBe(0)
      expect(report.results[0].decision).toBe('disabled')
    })

    it('should skip non-matching event types', () => {
      const rule = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Test Trigger',
        enabled: true,
        match: {
          event_type_allowlist: ['infrastructure.alert'],
        },
        action: {
          bundle_source: 'inline',
          mode: 'dry_run',
        },
      })

      const event = {
        schema_version: '1.0.0',
        event_version: '1.0' as const,
        event_type: 'different.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-001',
        tenant_id: TEST_TENANT_ID,
        source_app: 'jobforge' as const,
        payload: {},
        contains_pii: false,
      }

      const report = evaluateTriggers(event, [rule], { bundleTriggersEnabled: true })

      expect(report.rules_matched).toBe(0)
      expect(report.results[0].decision).toBe('skip')
    })

    it('should respect feature flag', () => {
      const rule = createTriggerRule({
        tenant_id: TEST_TENANT_ID,
        name: 'Test Trigger',
        enabled: true,
        match: {
          event_type_allowlist: ['test.event'],
        },
        action: {
          bundle_source: 'inline',
          mode: 'dry_run',
        },
      })

      const event = {
        schema_version: '1.0.0',
        event_version: '1.0' as const,
        event_type: 'test.event',
        occurred_at: new Date().toISOString(),
        trace_id: 'trace-001',
        tenant_id: TEST_TENANT_ID,
        source_app: 'jobforge' as const,
        payload: {},
        contains_pii: false,
      }

      const report = evaluateTriggers(event, [rule], { bundleTriggersEnabled: false })

      expect(report.rules_evaluated).toBe(0)
    })
  })
})

describe('Replay Bundle System', () => {
  describe('Bundle Creation', () => {
    it('should create a replay bundle', () => {
      const replay = createReplayBundle(
        'run-123',
        TEST_TENANT_ID,
        'autopilot.ops.scan',
        { scan_type: 'health' },
        { status: 'succeeded' },
        {
          capturedBy: 'test',
          captureReason: 'testing',
          tags: ['test', 'replay'],
        }
      )

      expect(replay.version).toBe('1.0')
      expect(replay.original_run_id).toBe('run-123')
      expect(replay.tenant_id).toBe(TEST_TENANT_ID)
      expect(replay.job_type).toBe('autopilot.ops.scan')
      expect(replay.metadata?.tags).toContain('test')
    })
  })

  describe('Bundle Parsing', () => {
    it('should parse valid replay bundle JSON', () => {
      const replay: JobReplayBundle = {
        version: '1.0',
        replay_id: 'replay-001',
        original_run_id: 'run-123',
        captured_at: new Date().toISOString(),
        tenant_id: TEST_TENANT_ID,
        job_type: 'autopilot.ops.scan',
        payload: { scan_type: 'health' },
        result: { status: 'succeeded' },
      }

      const json = JSON.stringify(replay)
      const parsed = parseReplayBundle(json)

      expect(parsed.replay_id).toBe('replay-001')
      expect(parsed.tenant_id).toBe(TEST_TENANT_ID)
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseReplayBundle('invalid json')).toThrow()
    })
  })

  describe('Bundle Conversion', () => {
    it('should convert replay to JobRequestBundle', () => {
      const replay: JobReplayBundle = {
        version: '1.0',
        replay_id: 'replay-001',
        original_run_id: 'run-123',
        captured_at: new Date().toISOString(),
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        job_type: 'autopilot.ops.scan',
        payload: {
          request_bundle: {
            schema_version: '1.0.0',
            bundle_id: 'original-bundle',
            tenant_id: TEST_TENANT_ID,
            project_id: TEST_PROJECT_ID,
            trace_id: 'trace-001',
            requests: [
              {
                id: 'req-001',
                job_type: 'autopilot.ops.scan',
                tenant_id: TEST_TENANT_ID,
                project_id: TEST_PROJECT_ID,
                payload: { scan_type: 'health' },
                idempotency_key: 'req-001-idem',
                required_scopes: ['ops:read'],
                is_action_job: false,
              },
            ],
            metadata: {
              source: 'test',
              triggered_at: new Date().toISOString(),
            },
          },
        },
        result: { status: 'succeeded' },
      }

      const { bundle, warnings } = convertReplayToBundle(replay)

      expect(bundle.schema_version).toBe('1.0.0')
      expect(bundle.tenant_id).toBe(TEST_TENANT_ID)
      expect(bundle.requests.length).toBe(1)
      expect(bundle.requests[0].job_type).toBe('autopilot.ops.scan')
    })

    it('should override tenant ID when requested', () => {
      const replay: JobReplayBundle = {
        version: '1.0',
        replay_id: 'replay-001',
        original_run_id: 'run-123',
        captured_at: new Date().toISOString(),
        tenant_id: TEST_TENANT_ID,
        job_type: 'autopilot.ops.scan',
        payload: {},
      }

      const newTenantId = '660e8400-e29b-41d4-a716-446655440000'
      const { bundle, warnings } = convertReplayToBundle(replay, {
        overrideTenantId: newTenantId,
      })

      expect(bundle.tenant_id).toBe(newTenantId)
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain('Tenant ID overridden')
    })

    it('should force dry-run for action jobs', () => {
      const replay: JobReplayBundle = {
        version: '1.0',
        replay_id: 'replay-001',
        original_run_id: 'run-123',
        captured_at: new Date().toISOString(),
        tenant_id: TEST_TENANT_ID,
        job_type: 'autopilot.ops.apply',
        payload: {
          request_bundle: {
            schema_version: '1.0.0',
            bundle_id: 'original-bundle',
            tenant_id: TEST_TENANT_ID,
            trace_id: 'trace-001',
            requests: [
              {
                id: 'req-001',
                job_type: 'autopilot.ops.apply',
                tenant_id: TEST_TENANT_ID,
                payload: {},
                idempotency_key: 'req-001-idem',
                required_scopes: ['ops:write'],
                is_action_job: true,
              },
            ],
            metadata: {
              source: 'test',
              triggered_at: new Date().toISOString(),
            },
          },
        },
      }

      const { bundle, warnings } = convertReplayToBundle(replay, {
        forceDryRun: true,
      })

      expect(bundle.requests[0].is_action_job).toBe(false)
      expect(warnings.some((w) => w.includes('dry-run'))).toBe(true)
    })
  })
})

describe('Contract Validation', () => {
  describe('Bundle Validation', () => {
    it('should validate a correct bundle', () => {
      const bundle = {
        schema_version: '1.0.0',
        bundle_id: 'test-bundle-001',
        tenant_id: TEST_TENANT_ID,
        project_id: TEST_PROJECT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.scan',
            tenant_id: TEST_TENANT_ID,
            project_id: TEST_PROJECT_ID,
            payload: { scan_type: 'health' },
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:read'],
            is_action_job: false,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = validateBundle(bundle)

      expect(result.valid).toBe(true)
      expect(result.errors.length).toBe(0)
    })

    it('should reject bundle with mismatched tenant IDs', () => {
      const bundle = {
        schema_version: '1.0.0',
        bundle_id: 'test-bundle',
        tenant_id: TEST_TENANT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.scan',
            tenant_id: 'different-tenant-id', // Mismatched
            payload: {},
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:read'],
            is_action_job: false,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = validateBundle(bundle)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('tenant'))).toBe(true)
    })

    it('should reject bundle with duplicate request IDs', () => {
      const bundle = {
        schema_version: '1.0.0',
        bundle_id: 'test-bundle',
        tenant_id: TEST_TENANT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.scan',
            tenant_id: TEST_TENANT_ID,
            payload: {},
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:read'],
            is_action_job: false,
          },
          {
            id: 'req-001', // Duplicate
            job_type: 'autopilot.ops.diagnose',
            tenant_id: TEST_TENANT_ID,
            payload: {},
            idempotency_key: 'req-002-idem',
            required_scopes: ['ops:read'],
            is_action_job: false,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = validateBundle(bundle)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)
    })
  })

  describe('Executor Simulation', () => {
    it('should validate tenant scoping', () => {
      const bundle = {
        schema_version: '1.0.0' as const,
        bundle_id: 'test-bundle',
        tenant_id: TEST_TENANT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.scan',
            tenant_id: TEST_TENANT_ID,
            payload: {},
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:read'],
            is_action_job: false,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = simulateExecutorValidation(bundle, {
        requiredTenantId: TEST_TENANT_ID,
      })

      expect(result.valid).toBe(true)
    })

    it('should block action jobs without policy token', () => {
      const bundle = {
        schema_version: '1.0.0' as const,
        bundle_id: 'test-bundle',
        tenant_id: TEST_TENANT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.apply',
            tenant_id: TEST_TENANT_ID,
            payload: {},
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:write'],
            is_action_job: true,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = simulateExecutorValidation(bundle, {
        policyTokenPresent: false,
      })

      expect(result.valid).toBe(false)
      expect(result.blocked.length).toBeGreaterThan(0)
    })

    it('should allow action jobs with policy token', () => {
      const bundle = {
        schema_version: '1.0.0' as const,
        bundle_id: 'test-bundle',
        tenant_id: TEST_TENANT_ID,
        trace_id: 'trace-001',
        requests: [
          {
            id: 'req-001',
            job_type: 'autopilot.ops.apply',
            tenant_id: TEST_TENANT_ID,
            payload: {},
            idempotency_key: 'req-001-idem',
            required_scopes: ['ops:write'],
            is_action_job: true,
          },
        ],
        metadata: {
          source: 'test',
          triggered_at: new Date().toISOString(),
        },
      }

      const result = simulateExecutorValidation(bundle, {
        policyTokenPresent: true,
      })

      expect(result.valid).toBe(true)
      expect(result.blocked.length).toBe(0)
    })
  })
})

describe('Integration: End-to-End Flow', () => {
  beforeEach(() => {
    clearTriggerStorage()
  })

  it('should handle full flow: event -> trigger -> bundle -> policy check', () => {
    // 1. Create a trigger rule
    const rule = createTriggerRule({
      tenant_id: TEST_TENANT_ID,
      name: 'Alert Handler',
      enabled: true,
      match: {
        event_type_allowlist: ['infrastructure.alert'],
      },
      action: {
        bundle_source: 'inline',
        mode: 'dry_run',
      },
      safety: {
        allow_action_jobs: false,
        cooldown_seconds: 60,
        max_runs_per_hour: 10,
      },
    })

    // 2. Submit an event
    const event = {
      schema_version: '1.0.0',
      event_version: '1.0' as const,
      event_type: 'infrastructure.alert',
      occurred_at: new Date().toISOString(),
      trace_id: 'integration-test-001',
      tenant_id: TEST_TENANT_ID,
      source_app: 'jobforge' as const,
      source_module: 'ops' as const,
      payload: { severity: 'high', message: 'CPU usage > 90%' },
      contains_pii: false,
    }

    // 3. Evaluate triggers
    const report = evaluateTriggers(event, [rule], { bundleTriggersEnabled: true })

    expect(report.rules_fired).toBe(1)
    expect(report.results[0].matched).toBe(true)
    expect(report.results[0].decision).toBe('fire')
    expect(report.results[0].dry_run).toBe(true) // Safety default

    // 4. Generate a policy token (for action jobs)
    const policyToken = generatePolicyToken(
      {
        tenantId: TEST_TENANT_ID,
        actorId: 'integration-test',
        action: 'autopilot.ops.apply',
        scopes: ['ops:write'],
        expiresInSeconds: 3600,
      },
      TEST_SECRET
    )

    // 5. Verify policy token
    const policyCheck = verifyPolicyToken(policyToken, TEST_SECRET, {
      requiredTenantId: TEST_TENANT_ID,
      requiredScopes: ['ops:write'],
    })

    expect(policyCheck.valid).toBe(true)

    // 6. Create a replay bundle from the result
    const replay = createReplayBundle(
      'integration-run-001',
      TEST_TENANT_ID,
      'jobforge.autopilot.execute_request_bundle',
      {
        trigger_report: report,
        policy_valid: policyCheck.valid,
      },
      undefined,
      {
        captureReason: 'integration test',
        tags: ['integration', 'test'],
      }
    )

    expect(replay.metadata?.tags).toContain('integration')
  })
})
