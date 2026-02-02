/**
 * MCP Server Smoke Test
 * Tests basic connectivity and tool availability
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  MCP_ENABLED,
  MCP_DEV_MODE,
  MCP_WRITE_ENABLED,
  MCP_READYLAYER_ENABLED,
  getMcpFeatureFlagSummary,
} from '../src/feature-flags'
import { toolRegistry, registerTool, listTools, checkToolAvailability } from '../src/tools/registry'
import { clearUsedPolicyTokens } from '../src/auth/resolver'
import { clearAuditLogs } from '../src/audit/emitter'

// Clear state before tests
beforeAll(() => {
  clearUsedPolicyTokens()
  clearAuditLogs()
})

describe('MCP Server', () => {
  describe('Feature Flags', () => {
    it('should have feature flags defined', () => {
      const summary = getMcpFeatureFlagSummary()
      expect(summary).toBeDefined()
      expect(typeof summary.enabled).toBe('boolean')
    })

    it('should default to disabled', () => {
      // In test environment, MCP_ENABLED should default to 0
      expect(MCP_ENABLED).toBe(false)
    })
  })

  describe('Tool Registry', () => {
    it('should register tools', () => {
      const initialCount = listTools().length

      // Register a test tool
      registerTool({
        name: 'test.tool.availability',
        description: 'Test tool for availability testing',
        inputSchema: {} as any,
        outputSchema: {} as any,
        requiredScopes: ['test:read'],
        isWrite: false,
        requiresPolicyToken: false,
        handler: async () => ({ success: true }),
      })

      expect(listTools().length).toBe(initialCount + 1)
    })

    it('should check tool availability', () => {
      const availability = checkToolAvailability('test.tool.availability')
      expect(availability).toBeDefined()
      expect(typeof availability.available).toBe('boolean')
    })

    it('should mark tools as unavailable when MCP disabled', () => {
      // When MCP_ENABLED is false, all tools should be unavailable
      const availability = checkToolAvailability('test.tool.availability')
      expect(availability.available).toBe(false)
      expect(availability.reason).toMatch(/disabled|MCP/)
    })
  })

  describe('Auth', () => {
    it('should have auth resolver', () => {
      // Just verify imports work
      expect(typeof clearUsedPolicyTokens).toBe('function')
    })
  })

  describe('Audit', () => {
    it('should have audit emitter', () => {
      expect(typeof clearAuditLogs).toBe('function')
    })
  })
})
