/**
 * Job handler registry
 * OPTIMIZED: Uses LRU cache for frequently accessed handlers
 */

import type {
  JobHandler,
  JobHandlerOptions,
  JobHandlerRegistration,
  JobTypeRegistry,
} from '@jobforge/shared'

interface CacheEntry {
  registration: JobHandlerRegistration
  lastAccessed: number
}

export class HandlerRegistry implements JobTypeRegistry {
  private handlers = new Map<string, JobHandlerRegistration>()
  // OPTIMIZED: LRU cache for hot handler lookups
  private accessCache = new Map<string, CacheEntry>()
  private readonly CACHE_MAX_SIZE = 100
  private readonly CACHE_TTL_MS = 60000 // 1 minute TTL

  register<TPayload = unknown, TResult = unknown>(
    type: string,
    handler: JobHandler<TPayload, TResult>,
    options?: JobHandlerOptions
  ): void {
    if (this.handlers.has(type)) {
      throw new Error(`Handler already registered for type: ${type}`)
    }

    this.handlers.set(type, { handler: handler as JobHandler, options })
  }

  get(type: string): JobHandlerRegistration | undefined {
    const now = Date.now()

    // Check access cache first (fast path)
    const cached = this.accessCache.get(type)
    if (cached && now - cached.lastAccessed < this.CACHE_TTL_MS) {
      // Update LRU order
      cached.lastAccessed = now
      return cached.registration
    }

    // Slow path: lookup in main registry
    const registration = this.handlers.get(type)
    if (registration) {
      // Add to cache with LRU eviction
      this.addToCache(type, registration, now)
    }

    return registration
  }

  has(type: string): boolean {
    // Use cache if available, otherwise check main registry
    const cached = this.accessCache.get(type)
    if (cached && Date.now() - cached.lastAccessed < this.CACHE_TTL_MS) {
      return true
    }
    return this.handlers.has(type)
  }

  list(): string[] {
    return Array.from(this.handlers.keys())
  }

  /**
   * Clear the access cache (useful for testing or memory management)
   */
  clearCache(): void {
    this.accessCache.clear()
  }

  /**
   * Get cache statistics for monitoring
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.accessCache.size,
      maxSize: this.CACHE_MAX_SIZE,
      hitRate: 0, // Would need instrumentation to track
    }
  }

  private addToCache(type: string, registration: JobHandlerRegistration, timestamp: number): void {
    // Evict oldest entries if at capacity
    if (this.accessCache.size >= this.CACHE_MAX_SIZE) {
      this.evictOldest()
    }

    this.accessCache.set(type, {
      registration,
      lastAccessed: timestamp,
    })
  }

  private evictOldest(): void {
    // Find and remove least recently used entry
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.accessCache) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.accessCache.delete(oldestKey)
    }
  }
}
