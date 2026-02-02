/**
 * Tests for JobForge Replay System
 * Covers canonicalization, stable hashing, and bundle export
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
    process.env = originalEnv
  })

  describe('canonicalizeObject', () => {
    it('should sort keys alphabetically', () => {
      const input = { z: 1, a: 2, m: 3 }
      const result = canonicalizeObject(input)
      expect(result).toBe('{"a":2,"m":3,"z":1}')
    })

    it('should handle nested objects', () => {
      const input = { z: { b: 1, a: 2 }, a: 3 }
      const result = canonicalizeObject(input)
      expect(result).toBe('{"a":3,"z":{"a":2,"b":1}}')
    })

    it('should handle arrays', () => {
      const input = {
        items: [
          { z: 1, a: 2 },
          { c: 3, b: 4 },
        ],
      }
      const result = canonicalizeObject(input)
      expect(result).toBe('{"items":[{"a":2,"z":1},{"b":4,"c":3}]}')
    })

    it('should remove undefined values', () => {
      const input = { a: 1, b: undefined, c: 3 }
      const result = canonicalizeObject(input)
      expect(result).toBe('{"a":1,"c":3}')
    })

    it('should handle null values', () => {
      const input = { a: null, b: 2 }
      const result = canonicalizeObject(input)
      expect(result).toBe('{"a":null,"b":2}')
    })

    it('should handle empty objects', () => {
      const input = {}
      const result = canonicalizeObject(input)
      expect(result).toBe('{}')
    })

    it('should handle complex nested structures', () => {
      const input = {
        user: {
          name: 'John',
          settings: {
            theme: 'dark',
            notifications: true,
          },
        },
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
        metadata: null,
      }
      const result = canonicalizeObject(input)
      const parsed = JSON.parse(result)
      expect(Object.keys(parsed)).toEqual(['items', 'metadata', 'user'])
      expect(Object.keys(parsed.user)).toEqual(['name', 'settings'])
      expect(Object.keys(parsed.user.settings)).toEqual(['notifications', 'theme'])
    })

    it('should produce consistent output for same input regardless of key order', () => {
      const input1 = { z: 1, a: 2, m: { c: 1, a: 2 } }
      const input2 = { a: 2, m: { a: 2, c: 1 }, z: 1 }
      expect(canonicalizeObject(input1)).toBe(canonicalizeObject(input2))
    })
  })

  describe('createInputSnapshot', () => {
    it('should create snapshot with hash', () => {
      const inputs = { a: 1, b: 2 }
      const snapshot = createInputSnapshot(inputs)

      expect(snapshot.canonicalJson).toBe('{"a":1,"b":2}')
      expect(snapshot.hash).toBeDefined()
      expect(snapshot.hash).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex
      expect(snapshot.originalKeys).toEqual(['a', 'b'])
      expect(snapshot.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('should produce same hash for same inputs regardless of key order', () => {
      const inputs1 = { z: 1, a: 2 }
      const inputs2 = { a: 2, z: 1 }

      const snapshot1 = createInputSnapshot(inputs1)
      const snapshot2 = createInputSnapshot(inputs2)

      expect(snapshot1.hash).toBe(snapshot2.hash)
    })

    it('should produce different hashes for different inputs', () => {
      const inputs1 = { a: 1 }
      const inputs2 = { a: 2 }

      const snapshot1 = createInputSnapshot(inputs1)
      const snapshot2 = createInputSnapshot(inputs2)

      expect(snapshot1.hash).not.toBe(snapshot2.hash)
    })
  })

  describe('getCodeFingerprint', () => {
    it('should return code fingerprint with timestamps', async () => {
      const fingerprint = await getCodeFingerprint()

      expect(fingerprint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      // Git values may be null if not in git repo
      expect(fingerprint.gitSha === null || /^[a-f0-9]{40}$/.test(fingerprint.gitSha!)).toBe(true)
      expect(fingerprint.gitDirty === null || typeof fingerprint.gitDirty === 'boolean').toBe(true)
    })
  })

  describe('getRuntimeFingerprint', () => {
    it('should return runtime fingerprint', () => {
      const fingerprint = getRuntimeFingerprint()

      expect(fingerprint.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/)
      expect(fingerprint.platform).toBeDefined()
      expect(fingerprint.arch).toBeDefined()
      expect(fingerprint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('getEnvironmentFingerprint', () => {
    it('should capture safe environment variables', () => {
      ;(process.env as Record<string, string | undefined>).NODE_ENV = 'test'
      ;(process.env as Record<string, string | undefined>).JOBFORGE_TEST_FLAG = '1'

      const fingerprint = getEnvironmentFingerprint()

      expect(fingerprint.envType).toBe('test')
      expect(fingerprint.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(fingerprint.identifiers.NODE_ENV).toBe('test')
    })

    it('should exclude secret-like environment variables', () => {
      ;(process.env as Record<string, string | undefined>).JOBFORGE_API_KEY = 'secret123'
      ;(process.env as Record<string, string | undefined>).JOBFORGE_SECRET = 'hidden'
      ;(process.env as Record<string, string | undefined>).JOBFORGE_TOKEN = 'token123'

      const fingerprint = getEnvironmentFingerprint()

      expect(fingerprint.identifiers.JOBFORGE_API_KEY).toBeUndefined()
      expect(fingerprint.identifiers.JOBFORGE_SECRET).toBeUndefined()
      expect(fingerprint.identifiers.JOBFORGE_TOKEN).toBeUndefined()
    })

    it('should include feature flags', () => {
      ;(process.env as Record<string, string | undefined>).REPLAY_PACK_ENABLED = '1'
      ;(process.env as Record<string, string | undefined>).JOBFORGE_EVENTS_ENABLED = '0'

      const fingerprint = getEnvironmentFingerprint()

      expect(fingerprint.featureFlags.REPLAY_PACK_ENABLED).toBe(true)
      expect(fingerprint.featureFlags.JOBFORGE_EVENTS_ENABLED).toBe(false)
    })
  })

  describe('verifyInputHash', () => {
    it('should verify correct hash', () => {
      const inputs = { a: 1, b: 2 }
      const snapshot = createInputSnapshot(inputs)

      expect(verifyInputHash(inputs, snapshot.hash)).toBe(true)
    })

    it('should reject incorrect hash', () => {
      const inputs = { a: 1, b: 2 }

      expect(verifyInputHash(inputs, 'wronghash')).toBe(false)
    })

    it('should handle canonicalization during verification', () => {
      const inputs1 = { z: 1, a: 2 }
      const inputs2 = { a: 2, z: 1 }
      const snapshot = createInputSnapshot(inputs1)

      expect(verifyInputHash(inputs2, snapshot.hash)).toBe(true)
    })
  })

  describe('compareBundles', () => {
    it('should identify equal bundles', () => {
      const bundle = {
        version: '1.0' as const,
        provenance: {
          runId: 'run-1',
          tenantId: 'tenant-1',
          jobType: 'test',
          inputs: {
            canonicalJson: '{}',
            hash: 'hash1',
            originalKeys: [],
            timestamp: '2024-01-01T00:00:00Z',
          },
          code: {
            gitSha: 'abc123',
            gitBranch: 'main',
            gitDirty: false,
            timestamp: '2024-01-01T00:00:00Z',
          },
          runtime: {
            nodeVersion: 'v20.0.0',
            pnpmVersion: '8.0.0',
            platform: 'linux',
            arch: 'x64',
            timestamp: '2024-01-01T00:00:00Z',
          },
          dependencies: {
            lockfileHash: 'lock1',
            packageHash: 'pkg1',
            dependencyCount: 100,
            timestamp: '2024-01-01T00:00:00Z',
          },
          environment: {
            identifiers: {},
            envType: 'test',
            featureFlags: {},
            timestamp: '2024-01-01T00:00:00Z',
          },
          createdAt: '2024-01-01T00:00:00Z',
        },
        logRefs: [],
        artifactRefs: [],
        metadata: {
          exportedAt: '2024-01-01T00:00:00Z',
          exportedBy: 'test',
          isDryRun: false,
        },
      }

      const result = compareBundles(bundle, bundle)
      expect(result.equal).toBe(true)
      expect(result.differences).toEqual([])
    })

    it('should identify different bundles', () => {
      const bundle1: ReplayBundle = {
        version: '1.0',
        provenance: {
          runId: 'run-1',
          tenantId: 'tenant-1',
          jobType: 'test',
          inputs: {
            canonicalJson: '{}',
            hash: 'hash1',
            originalKeys: [],
            timestamp: '2024-01-01T00:00:00Z',
          },
          code: {
            gitSha: 'abc123',
            gitBranch: 'main',
            gitDirty: false,
            timestamp: '2024-01-01T00:00:00Z',
          },
          runtime: {
            nodeVersion: 'v20.0.0',
            pnpmVersion: '8.0.0',
            platform: 'linux',
            arch: 'x64',
            timestamp: '2024-01-01T00:00:00Z',
          },
          dependencies: {
            lockfileHash: 'lock1',
            packageHash: 'pkg1',
            dependencyCount: 100,
            timestamp: '2024-01-01T00:00:00Z',
          },
          environment: {
            identifiers: {},
            envType: 'test',
            featureFlags: {},
            timestamp: '2024-01-01T00:00:00Z',
          },
          createdAt: '2024-01-01T00:00:00Z',
        },
        logRefs: [],
        artifactRefs: [],
        metadata: {
          exportedAt: '2024-01-01T00:00:00Z',
          exportedBy: 'test',
          isDryRun: false,
        },
      }

      const bundle2: ReplayBundle = {
        ...bundle1,
        provenance: {
          ...bundle1.provenance,
          inputs: {
            ...bundle1.provenance.inputs,
            hash: 'hash2',
          },
          code: {
            ...bundle1.provenance.code,
            gitSha: 'def456',
          },
        },
      }

      const result = compareBundles(bundle1, bundle2)
      expect(result.equal).toBe(false)
      expect(result.differences).toContain('inputs.hash')
      expect(result.differences).toContain('code.gitSha')
    })
  })

  describe('replayDryRun', () => {
    it('should simulate replay without side effects', async () => {
      const bundle: ReplayBundle = {
        version: '1.0',
        provenance: {
          runId: 'run-1',
          tenantId: 'tenant-1',
          jobType: 'test.job',
          inputs: {
            canonicalJson: '{"key":"value"}',
            hash: 'abc123',
            originalKeys: ['key'],
            timestamp: '2024-01-01T00:00:00Z',
          },
          code: {
            gitSha: 'def456',
            gitBranch: 'main',
            gitDirty: false,
            timestamp: '2024-01-01T00:00:00Z',
          },
          runtime: {
            nodeVersion: process.version,
            pnpmVersion: null,
            platform: process.platform,
            arch: process.arch,
            timestamp: '2024-01-01T00:00:00Z',
          },
          dependencies: {
            lockfileHash: 'lock1',
            packageHash: 'pkg1',
            dependencyCount: 100,
            timestamp: '2024-01-01T00:00:00Z',
          },
          environment: {
            identifiers: {},
            envType: 'test',
            featureFlags: {},
            timestamp: '2024-01-01T00:00:00Z',
          },
          createdAt: '2024-01-01T00:00:00Z',
        },
        logRefs: ['log1'],
        artifactRefs: ['art1'],
        metadata: {
          exportedAt: '2024-01-01T00:00:00Z',
          exportedBy: 'test',
          isDryRun: true,
        },
      }

      const result = await replayDryRun(bundle, { maxLogLines: 50 })

      expect(result.success).toBe(true)
      expect(result.originalRunId).toBe('run-1')
      expect(result.replayRunId).toBeDefined()
      expect(result.logs.length).toBeGreaterThan(0)
      expect(result.logs[0]).toContain('dry-run replay')
    })

    it('should detect version differences', async () => {
      const bundle: ReplayBundle = {
        version: '1.0',
        provenance: {
          runId: 'run-1',
          tenantId: 'tenant-1',
          jobType: 'test.job',
          inputs: {
            canonicalJson: '{"key":"value"}',
            hash: 'abc123',
            originalKeys: ['key'],
            timestamp: '2024-01-01T00:00:00Z',
          },
          code: {
            gitSha: 'old-sha',
            gitBranch: 'main',
            gitDirty: false,
            timestamp: '2024-01-01T00:00:00Z',
          },
          runtime: {
            nodeVersion: 'v18.0.0', // Different from current
            pnpmVersion: null,
            platform: 'linux',
            arch: 'x64',
            timestamp: '2024-01-01T00:00:00Z',
          },
          dependencies: {
            lockfileHash: 'lock1',
            packageHash: 'pkg1',
            dependencyCount: 100,
            timestamp: '2024-01-01T00:00:00Z',
          },
          environment: {
            identifiers: {},
            envType: 'test',
            featureFlags: {},
            timestamp: '2024-01-01T00:00:00Z',
          },
          createdAt: '2024-01-01T00:00:00Z',
        },
        logRefs: [],
        artifactRefs: [],
        metadata: {
          exportedAt: '2024-01-01T00:00:00Z',
          exportedBy: 'test',
          isDryRun: true,
        },
      }

      const result = await replayDryRun(bundle)

      expect(result.differences.length).toBeGreaterThan(0)
      expect(result.differences.some((d) => d.field === 'code.gitSha')).toBe(true)
      expect(result.differences.some((d) => d.field === 'runtime.nodeVersion')).toBe(true)
    })
  })

  describe('Feature Flag Integration', () => {
    it('should return null when REPLAY_PACK_ENABLED=0', async () => {
      ;(process.env as Record<string, string | undefined>).REPLAY_PACK_ENABLED = '0'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })

    it('should capture provenance when REPLAY_PACK_ENABLED=1', async () => {
      ;(process.env as Record<string, string | undefined>).REPLAY_PACK_ENABLED = '1'

      const result = await captureRunProvenance('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).not.toBeNull()
      expect(result?.runId).toBe('run-1')
      expect(result?.tenantId).toBe('tenant-1')
      expect(result?.jobType).toBe('test.job')
      expect(result?.inputs.hash).toBeDefined()
    })

    it('should export bundle when REPLAY_PACK_ENABLED=1', async () => {
      ;(process.env as Record<string, string | undefined>).REPLAY_PACK_ENABLED = '1'

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
      ;(process.env as Record<string, string | undefined>).REPLAY_PACK_ENABLED = '0'

      const result = await exportReplayBundle('run-1', 'tenant-1', 'test.job', { key: 'value' })

      expect(result).toBeNull()
    })
  })
})
