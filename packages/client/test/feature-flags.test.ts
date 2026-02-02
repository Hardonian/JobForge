/**
 * @jobforge/client - Feature flags tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isIntegrationEnabled,
  isDryRunMode,
  getFeatureFlagSummary,
  verifyIntegrationAvailable,
} from '../src/feature-flags'

describe('Feature Flags', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Store original values
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    // Restore original values
    process.env = originalEnv
  })

  describe('isIntegrationEnabled', () => {
    it('should return false by default', () => {
      // Default should be false when env var is not set
      expect(isIntegrationEnabled()).toBe(false)
    })
  })

  describe('isDryRunMode', () => {
    it('should return true when integration is disabled', () => {
      // When integration is disabled, dry run defaults to true
      expect(isDryRunMode()).toBe(true)
    })
  })

  describe('getFeatureFlagSummary', () => {
    it('should return summary object', () => {
      const summary = getFeatureFlagSummary()

      expect(summary).toHaveProperty('integration_enabled')
      expect(summary).toHaveProperty('dry_run_mode')
      expect(summary).toHaveProperty('api_endpoint_set')
      expect(summary).toHaveProperty('api_key_set')
      expect(summary).toHaveProperty('api_endpoint')
    })
  })

  describe('verifyIntegrationAvailable', () => {
    it('should not throw in dry run mode (default)', () => {
      // By default, dry run is enabled when integration is disabled
      expect(() => verifyIntegrationAvailable()).not.toThrow()
    })
  })
})
