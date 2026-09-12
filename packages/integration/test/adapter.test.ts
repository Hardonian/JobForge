import { describe, it, expect } from 'vitest'
import { JobForgeAdapter, createJobForgeAdapter, generateTraceId } from '../src/index'

describe('@jobforge/integration', () => {
  it('should export JobForgeAdapter and helper functions', () => {
    expect(JobForgeAdapter).toBeDefined()
    expect(createJobForgeAdapter).toBeDefined()
    expect(generateTraceId).toBeDefined()
  })

  it('should generate valid trace IDs', () => {
    const traceId = generateTraceId()
    expect(typeof traceId).toBe('string')
    expect(traceId.length).toBeGreaterThan(10)
  })

  it('should instantiate JobForgeAdapter with app name', () => {
    const adapter = createJobForgeAdapter('aias')
    expect(adapter).toBeInstanceOf(JobForgeAdapter)
    expect(adapter.getConfig().app).toBe('aias')
  })
})
