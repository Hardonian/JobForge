/**
 * @jobforge/client - Client integration tests
 * Tests for the main client class
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createClient, ExecutionPlaneClient } from '../src/client'

describe('ExecutionPlaneClient', () => {
  describe('createClient', () => {
    it('should create client with default config', () => {
      // In dry-run mode, no credentials needed
      const client = createClient()
      expect(client).toBeInstanceOf(ExecutionPlaneClient)
    })

    it('should create client with custom config', () => {
      const client = createClient({
        supabaseUrl: 'http://localhost:54321',
        supabaseKey: 'test-key',
        defaultTenantId: 'test-tenant',
        dryRun: true,
      })
      expect(client).toBeInstanceOf(ExecutionPlaneClient)
    })
  })

  describe('isEnabled', () => {
    it('should return false by default', () => {
      const client = createClient()
      expect(client.isEnabled()).toBe(false)
    })
  })

  describe('isDryRun', () => {
    it('should return true by default', () => {
      const client = createClient()
      expect(client.isDryRun()).toBe(true)
    })

    it('should return configured dry run value', () => {
      // When setting dryRun: false, need to provide credentials
      const client = createClient({
        supabaseUrl: 'http://localhost:54321',
        supabaseKey: 'test-key',
        dryRun: false,
      })
      expect(client.isDryRun()).toBe(false)
    })
  })

  describe('getFeatureFlags', () => {
    it('should return feature flag summary', () => {
      const client = createClient()
      const flags = client.getFeatureFlags()

      expect(flags).toHaveProperty('integration_enabled')
      expect(flags).toHaveProperty('dry_run_mode')
    })
  })
})
