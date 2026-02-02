/**
 * JobForge Handler Registry
 * Register all job type handlers here
 */

import { HandlerRegistry } from '../lib/registry'
import { httpRequestHandler } from './http-request'
import { webhookDeliverHandler } from './webhook-deliver'
import { reportGenerateHandler } from './report-generate'
import { verifyPackHandler, VerifyPackPayloadSchema } from '@jobforge/shared'

/**
 * Create and configure the default handler registry
 */
export function createDefaultRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry()

  // Register HTTP request handler
  registry.register('connector.http.request', httpRequestHandler, {
    timeoutMs: 60_000, // 1 minute
    validate: (payload) => {
      // Basic validation - actual validation done in handler via zod
      return typeof payload === 'object' && payload !== null && 'url' in payload
    },
  })

  // Register webhook delivery handler
  registry.register('connector.webhook.deliver', webhookDeliverHandler, {
    timeoutMs: 60_000, // 1 minute
    validate: (payload) => {
      return (
        typeof payload === 'object' &&
        payload !== null &&
        'target_url' in payload &&
        'event_type' in payload
      )
    },
  })

  // Register report generation handler
  registry.register('connector.report.generate', reportGenerateHandler, {
    timeoutMs: 300_000, // 5 minutes for complex reports
    validate: (payload) => {
      return typeof payload === 'object' && payload !== null && 'report_type' in payload
    },
  })

  // Register ReadyLayer verify_pack handler (autopilot job)
  registry.register('autopilot.readylayer.verify_pack', verifyPackHandler, {
    timeoutMs: 600_000, // 10 minutes for full verification
    validate: (payload) => {
      const result = VerifyPackPayloadSchema.safeParse(payload)
      return result.success
    },
  })

  return registry
}

// Export handlers for testing
export { httpRequestHandler, webhookDeliverHandler, reportGenerateHandler }
