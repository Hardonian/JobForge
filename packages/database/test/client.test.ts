import { describe, it, expect } from 'vitest'

/**
 * Smoke tests for database client.
 * These verify the client can be imported and basic functions exist.
 * Full integration tests require a running database.
 */
describe('Database Client', () => {
  it('should export prisma client', async () => {
    const { prisma } = await import('../src/client')
    expect(prisma).toBeDefined()
    expect(typeof prisma.$connect).toBe('function')
    expect(typeof prisma.$disconnect).toBe('function')
  })

  it('should export disconnectPrisma function', async () => {
    const { disconnectPrisma } = await import('../src/client')
    expect(disconnectPrisma).toBeDefined()
    expect(typeof disconnectPrisma).toBe('function')
  })

  it('should export checkDatabaseHealth function', async () => {
    const { checkDatabaseHealth } = await import('../src/client')
    expect(checkDatabaseHealth).toBeDefined()
    expect(typeof checkDatabaseHealth).toBe('function')
  })
})
