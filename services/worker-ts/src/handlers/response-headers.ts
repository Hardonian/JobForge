export interface ResponseHeaderOptions {
  redactHeaders: string[]
  allowlist?: string[]
}

const MAX_ALLOWLIST_LOOKUP = 20

export function collectResponseHeaders(
  response: Response,
  options: ResponseHeaderOptions
): Record<string, string> {
  const redacted = new Set(options.redactHeaders.map((header) => header.toLowerCase()))
  const allowlist = options.allowlist?.map((header) => header.toLowerCase()).filter(Boolean)

  if (allowlist && allowlist.length > 0 && allowlist.length <= MAX_ALLOWLIST_LOOKUP) {
    const result: Record<string, string> = {}
    for (const header of allowlist) {
      if (redacted.has(header)) {
        continue
      }
      const value = response.headers.get(header)
      if (value !== null) {
        result[header] = value
      }
    }
    return result
  }

  const result: Record<string, string> = {}
  response.headers.forEach((value, key) => {
    if (!redacted.has(key.toLowerCase())) {
      result[key] = value
    }
  })
  return result
}
