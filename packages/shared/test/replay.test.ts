/**
 * Tests for JobForge Replay System
 * Covers canonicalization, stable hashing, and bundle export
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Mock feature-flags module to control REPLAY_PACK_ENABLED
vi.mock('../src/feature-flags.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/feature-flags.js')>('../src/feature-flags.js')
  return {
    ...actual,
    get REPLAY_PACK_ENABLED() {
      return process.env.REPLAY_PACK_ENABLED === '1'
    },
  }
})

import {
  canonicalizeObject,
  createInputSnapshot,
  getCodeFingerprint,
  getRuntimeFingerprint,
  getEnvironmentFingerprint,
  captureRunProvenance,
  exportReplayBundle,
  replayDryRun,
  verifyInputHash,
  compareBundles,
  type ReplayBundle,
} from '../src/replay'

describe('Replay System', () => {
  // Store original env
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Reset env for each test
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    // Restore original env
    process.env = originalEnv
    // Clear module cache to reset mocked values
    vi.clearAllMocks()
  })

  describe('Canonicalization', () => {
    it('should sort object keys stably', () => {
      const input = { z: 1, a: 2, m: 3 }
      const result = canonicalizeObject(input)

      // Result should have sorted keys
      const keys = Object.keys(result)
      expect(keys).toEqual(['a', 'm', 'z'])
      expect(result).toEqual({ a: 2, m: 3, z: 1 })
    })

    it('should handle nested objects', () => {
      const input = {
        z: { b: 1, a: 2 },
        a: { z: 3, a: 4 },
      }
      const result = canonicalizeObject(input)

      expect(Object.keys(result)).toEqual(['a', 'z'])
      expect(Object.keys(result.a)).toEqual(['a', 'z'])
      expect(Object.keys(result.z)).toEqual(['a', 'b'])
    })

    it('should handle arrays without sorting', () => {
      const input = { z: [3, 1, 2], a: 'value' }
      const result = canonicalizeObject(input)

      expect(Object.keys(result)).toEqual(['a', 'z'])
      expect(result.z).toEqual([3, 1, 2]) // Array order preserved
    })

    it('should handle null and undefined', () => {
      const input = { z: null, a: undefined, b: 'value' }
      const result = canonicalizeObject(input)

      expect(Object.keys(result)).toEqual(['a', 'b', 'z'])
      expect(result.z).toBeNull()
      expect(result.a).toBeUndefined()
    })
  })

  describe('Input Snapshot', () => {
    it('should create input snapshot with hash', () => {
      const inputs = { b: 2, a: 1 }
      const snapshot = createInputSnapshot(inputs)

      expect(snapshot.canonicalJson).toBe('{"a":1,"b":2}')
      expect(snapshot.hash).toBeDefined()
      expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex
      expect(snapshot.originalKeys).toEqual(['b', 'a'])
    })

    it('should create different hashes for different inputs', () => {
      const snapshot1 = createInputSnapshot({ a: 1 })
      const snapshot2 = createInputSnapshot({ a: 2 })

      expect(snapshot1.hash).not.toBe(snapshot2.hash)
    })

    it('should create same hash for canonically equivalent inputs', () => {
      const snapshot1 = createInputSnapshot({ a: 1, b: 2 })
      const snapshot2 = createInputSnapshot({ b: 2, a: 1 })

      expect(snapshot1.hash).toBe(snapshot2.hash)
    })
  })

  describe('Fingerprinting', () => {
    it('should capture code fingerprint', () => {
      const fingerprint = getCodeFingerprint()

      expect(fingerprint.gitSha).toBeDefined()
      expect(fingerprint.gitBranch).toBeDefined()
      expect(fingerprint.timestamp).toBeDefined()
    })

    it('should capture runtime fingerprint', () => {
      const fingerprint = getRuntimeFingerprint()

      expect(fingerprint.nodeVersion).toBeDefined()
      expect(fingerprint.platform).toBeDefined()
      expect(fingerprint.arch).toBeDefined()
      expect(fingerprint.timestamp).toBeDefined()
    })

    it('should capture environment fingerprint', () => {
      const fingerprint = getEnvironmentFingerprint()

      expect(fingerprint.nodeVersion).toBeDefined()
      expect(fingerprint.platform).toBeDefined()
      expect(fingerprint.timestamp).toBeDefined()
    })
  })

  describe('Run Provenance', () => {
    it('should capture run provenance', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).not.toBeNull()
      expect(result?.runId).toBe('run-1')
      expect(result?.tenantId).toBe('tenant-1')
      expect(result?.jobType).toBe('test.job')
      expect(result?.inputs.hash).toBeDefined()
      expect(result?.codeFingerprint).toBeDefined()
      expect(result?.runtimeFingerprint).toBeDefined()
    })

    it('should return null when REPLAY_PACK_ENABLED=0', async () => {
      process.env.REPLAY_PACK_ENABLED = '0'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })
  })

  describe('Bundle Export', () => {
    it('should export replay bundle', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const result = await exportReplayBundle(
        'run-1',
        'tenant-1',
        'test.job',
        { key: 'value' },
        { logRefs: ['log1'], artifactRefs: ['art1'] }
      )

      expect(result).not.toBeNull()
      expect(result?.version).toBe('1.0')
      expect(result?.provenance.runId).toBe('run-1')
      expect(result?.logRefs).toEqual(['log1'])
      expect(result?.artifactRefs).toEqual(['art1'])
    })

    it('should return null bundle export when REPLAY_PACK_ENABLED=0', async () => {
      process.env.REPLAY_PACK_ENABLED = '0'

      const result = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })
  })

  describe('Verification', () => {
    it('should verify matching input hash', () => {
      const inputs = { key: 'value' }
      const snapshot = createInputSnapshot(inputs)

      const isValid = verifyInputHash(inputs, snapshot.hash)

      expect(isValid).toBe(true)
    })

    it('should reject non-matching input hash', () => {
      const inputs = { key: 'value' }
      const snapshot = createInputSnapshot(inputs)

      const isValid = verifyInputHash({ key: 'different' }, snapshot.hash)

      expect(isValid).toBe(false)
    })
  })

  describe('Comparison', () => {
    it('should compare identical bundles', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const bundle1 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })
      const bundle2 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })

      // Both should be non-null
      expect(bundle1).not.toBeNull()
      expect(bundle2).not.toBeNull()

      if (bundle1 && bundle2) {
        const comparison = compareBundles(bundle1, bundle2)

        expect(comparison.identical).toBe(true)
        expect(comparison.differences).toHaveLength(0)
      }
    })

    it('should detect different inputs', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const bundle1 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value1' })
      const bundle2 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value2' })

      expect(bundle1).not.toBeNull()
      expect(bundle2).not.toBeNull()

      if (bundle1 && bundle2) {
        const comparison = compareBundles(bundle1, bundle2)

        expect(comparison.identical).toBe(false)
        expect(comparison.differences.some((d) => d.field === 'provenance.inputs.hash')).toBe(true)
      }
    })

    it('should detect different runtimes', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const bundle1 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })
      // Simulate different runtime by modifying after export
      const bundle2 = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(bundle1).not.toBeNull()
      expect(bundle2).not.toBeNull()

      if (bundle1 && bundle2) {
        // Runtime timestamps will differ
        const comparison = compareBundles(bundle1, bundle2)

        // Should have runtime differences but identical inputs
        expect(comparison.differences.some((d) => d.field.startsWith('runtime'))).toBe(true)
      }
    })
  })

  describe('Dry Run Comparison', () => {
    it('should execute dry run with matching inputs', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const original = await exportReplayBundle(
        'run-1',
        'tenant-1',
        'test.job',
        { key: 'value' },
        { logRefs: ['log1'] }
      )

      expect(original).not.toBeNull()

      if (original) {
        const result = await replayDryRun(original, { key: 'value' })

        expect(result.canReplay).toBe(true)
        expect(result.inputComparison.match).toBe(true)
      }
    })

    it('should detect input mismatch in dry run', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const original = await exportReplayBundle(
        'run-1',
        'tenant-1',
        'test.job',
        { key: 'original' },
        { logRefs: ['log1'] }
      )

      expect(original).not.toBeNull()

      if (original) {
        const result = await replayDryRun(original, { key: 'different' })

        expect(result.canReplay).toBe(false)
        expect(result.inputComparison.match).toBe(false)
        expect(result.inputComparison.differences).toBeDefined()
      }
    })

    it('should return null when REPLAY_PACK_ENABLED=0', async () => {
      process.env.REPLAY_PACK_ENABLED = '0'

      const result = await replayDryRun({} as ReplayBundle, { key: 'value' })

      expect(result).toBeNull()
    })
  })

  describe('Feature Flag Integration', () => {
    it('should respect REPLAY_PACK_ENABLED=0 for provenance', async () => {
      process.env.REPLAY_PACK_ENABLED = '0'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })

    it('should respect REPLAY_PACK_ENABLED=0 for bundle export', async () => {
      process.env.REPLAY_PACK_ENABLED = '0'

      const result = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })

    it('should work when REPLAY_PACK_ENABLED=1 for provenance', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).not.toBeNull()
      expect(result?.runId).toBe('run-1')
      expect(result?.tenantId).toBe('tenant-1')
      expect(result?.jobType).toBe('test.job')
      expect(result?.inputs.hash).toBeDefined()
    })

    it('should work when REPLAY_PACK_ENABLED=1 for bundle export', async () => {
      process.env.REPLAY_PACK_ENABLED = '1'

      const result = await exportReplayBundle(
        'run-1',
        'tenant-1',
        'test.job',
        { key: 'value' },
        { logRefs: ['log1'], artifactRefs: ['art1'] }
      )

      expect(result).not.toBeNull()
      expect(result?.version).toBe('1.0')
      expect(result?.provenance.runId).toBe('run-1')
      expect(result?.logRefs).toEqual(['log1'])
      expect(result?.artifactRefs).toEqual(['art1'])
    })
  })
})
