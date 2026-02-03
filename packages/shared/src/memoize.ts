/**
 * Deterministic memoization utility for caching expensive operations
 * Uses JSON serialization for cache keys (deterministic)
 * Includes TTL support for time-based cache invalidation
 */

export interface MemoizeOptions<T> {
  /** Time-to-live in milliseconds (default: no expiration) */
  ttl?: number
  /** Maximum cache size (LRU eviction, default: 1000) */
  maxSize?: number
  /** Custom key generator (default: JSON.stringify) */
  keyGenerator?: (args: unknown[]) => string
  /** Predicate to determine if result should be cached */
  shouldCache?: (result: T) => boolean
}

interface CacheEntry<T> {
  value: T
  timestamp: number
}

/**
 * Create a memoized version of a function with deterministic caching
 */
export function memoize<T, Args extends unknown[]>(
  fn: (...args: Args) => T,
  options: MemoizeOptions<T> = {}
): (...args: Args) => T {
  const {
    ttl,
    maxSize = 1000,
    keyGenerator = (args) => JSON.stringify(args),
    shouldCache = () => true,
  } = options

  const cache = new Map<string, CacheEntry<T>>()
  const keyOrder: string[] = []

  return (...args: Args): T => {
    const key = keyGenerator(args)
    const now = Date.now()

    // Check cache
    const cached = cache.get(key)
    if (cached) {
      // Check TTL
      if (ttl && now - cached.timestamp > ttl) {
        cache.delete(key)
        const index = keyOrder.indexOf(key)
        if (index > -1) keyOrder.splice(index, 1)
      } else {
        // Move to end (LRU)
        const index = keyOrder.indexOf(key)
        if (index > -1) {
          keyOrder.splice(index, 1)
          keyOrder.push(key)
        }
        return cached.value
      }
    }

    // Execute function
    const result = fn(...args)

    // Cache result if allowed
    if (shouldCache(result)) {
      // Evict oldest if at capacity
      if (cache.size >= maxSize && keyOrder.length > 0) {
        const oldestKey = keyOrder.shift()
        if (oldestKey) cache.delete(oldestKey)
      }

      cache.set(key, { value: result, timestamp: now })
      keyOrder.push(key)
    }

    return result
  }
}

/**
 * Create a memoized version of an async function
 */
export function memoizeAsync<T, Args extends unknown[]>(
  fn: (...args: Args) => Promise<T>,
  options: MemoizeOptions<T> = {}
): (...args: Args) => Promise<T> {
  const {
    ttl,
    maxSize = 1000,
    keyGenerator = (args) => JSON.stringify(args),
    shouldCache = () => true,
  } = options

  const cache = new Map<string, CacheEntry<T>>()
  const keyOrder: string[] = []
  const inFlight = new Map<string, Promise<T>>()

  return async (...args: Args): Promise<T> => {
    const key = keyGenerator(args)
    const now = Date.now()

    // Check cache
    const cached = cache.get(key)
    if (cached) {
      if (ttl && now - cached.timestamp > ttl) {
        cache.delete(key)
        const index = keyOrder.indexOf(key)
        if (index > -1) keyOrder.splice(index, 1)
      } else {
        // Move to end (LRU)
        const index = keyOrder.indexOf(key)
        if (index > -1) {
          keyOrder.splice(index, 1)
          keyOrder.push(key)
        }
        return cached.value
      }
    }

    // Check for in-flight request (deduplication)
    const existing = inFlight.get(key)
    if (existing) {
      return existing
    }

    // Execute function
    const promise = fn(...args).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, promise)

    const result = await promise

    // Cache result if allowed
    if (shouldCache(result)) {
      // Evict oldest if at capacity
      if (cache.size >= maxSize && keyOrder.length > 0) {
        const oldestKey = keyOrder.shift()
        if (oldestKey) cache.delete(oldestKey)
      }

      cache.set(key, { value: result, timestamp: now })
      keyOrder.push(key)
    }

    return result
  }
}

/**
 * Clear all caches (useful for testing)
 */
export function clearMemoizationCaches(): void {
  // This is a no-op - each memoized function has its own cache
  // Individual caches can be cleared by creating new memoized functions
}
