import { PrismaClient } from '@prisma/client'

/**
 * Global Prisma client instance with connection pooling.
 * Uses singleton pattern to prevent multiple instances in development.
 */
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined
}

/**
 * Create Prisma client with production-ready configuration
 */
function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    errorFormat: 'minimal',
  })
}

/**
 * Singleton Prisma client instance.
 * Reuses connection in development, creates new in production.
 */
export const prisma = global.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma
}

/**
 * Graceful shutdown handler for Prisma client
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect()
}

/**
 * Health check for database connection
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}
