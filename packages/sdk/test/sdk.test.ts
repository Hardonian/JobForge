import { describe, it, expect } from 'vitest'
import * as SDK from '../src/index'

describe('@jobforge/sdk', () => {
  it('should re-export client and shared components', () => {
    expect(SDK.JobForgeClient).toBeDefined()
    expect(SDK.enqueueJobParamsSchema).toBeDefined()
    expect(SDK.CONNECTOR_STATUS).toBeDefined()
  })
})
