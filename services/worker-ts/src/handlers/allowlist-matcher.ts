type HostnameMatcher = (hostname: string) => boolean

interface AllowlistEntry {
  exact?: string
  suffix?: string
  regex?: RegExp
}

const ALLOWLIST_CACHE = new Map<string, AllowlistEntry[]>()
const MAX_CACHE_ENTRIES = 100

function normalizeAllowlist(allowlist: string[]): string[] {
  return allowlist.map((pattern) => pattern.toLowerCase().trim()).filter(Boolean)
}

function compileAllowlist(allowlist: string[]): AllowlistEntry[] {
  const normalized = normalizeAllowlist(allowlist)
  return normalized.map((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
      return { regex }
    }
    return { exact: pattern, suffix: `.${pattern}` }
  })
}

export function getAllowlistMatcher(allowlist?: string[]): HostnameMatcher | null {
  if (!allowlist || allowlist.length === 0) {
    return null
  }

  const normalized = normalizeAllowlist(allowlist)
  if (normalized.length === 0) {
    return null
  }

  const cacheKey = normalized.join('|')
  let compiled = ALLOWLIST_CACHE.get(cacheKey)
  if (!compiled) {
    compiled = compileAllowlist(normalized)
    ALLOWLIST_CACHE.set(cacheKey, compiled)
    if (ALLOWLIST_CACHE.size > MAX_CACHE_ENTRIES) {
      const oldestKey = ALLOWLIST_CACHE.keys().next().value
      if (oldestKey) {
        ALLOWLIST_CACHE.delete(oldestKey)
      }
    }
  }

  return (hostname: string) => {
    for (const entry of compiled) {
      if (entry.regex && entry.regex.test(hostname)) {
        return true
      }
      if (entry.exact && (hostname === entry.exact || hostname.endsWith(entry.suffix ?? ''))) {
        return true
      }
    }
    return false
  }
}
