/**
 * JobForge Handler Registry
 * Register all job type handlers here
 */

import { HandlerRegistry } from '../lib/registry'
import { httpRequestHandler } from './http-request'
import { webhookDeliverHandler } from './webhook-deliver'
import { reportGenerateHandler } from './report-generate'
import { verifyPackHandler, VerifyPackPayloadSchema } from '@jobforge/shared'

// Autopilot Ops handlers
import {
  opsScanHandler,
  OpsScanPayloadSchema,
  opsDiagnoseHandler,
  OpsDiagnosePayloadSchema,
  opsRecommendHandler,
  OpsRecommendPayloadSchema,
  opsApplyHandler,
  OpsApplyPayloadSchema,
} from './autopilot/ops'

// Autopilot Support handlers
import {
  supportTriageHandler,
  SupportTriagePayloadSchema,
  supportDraftReplyHandler,
  SupportDraftReplyPayloadSchema,
  supportProposeKbPatchHandler,
  SupportProposeKbPatchPayloadSchema,
} from './autopilot/support'

// Autopilot Growth handlers
import {
  growthSeoScanHandler,
  GrowthSeoScanPayloadSchema,
  growthExperimentProposeHandler,
  GrowthExperimentProposePayloadSchema,
  growthContentDraftHandler,
  GrowthContentDraftPayloadSchema,
} from './autopilot/growth'

// Autopilot FinOps handlers
import {
  finopsReconcileHandler,
  FinopsReconcilePayloadSchema,
  finopsAnomalyScanHandler,
  FinopsAnomalyScanPayloadSchema,
  finopsChurnRiskReportHandler,
  FinopsChurnRiskReportPayloadSchema,
} from './autopilot/finops'

// Autopilot Bundle executor
import {
  executeRequestBundleHandler,
  ExecuteRequestBundlePayloadSchema,
} from './autopilot/execute-bundle'
import { runModuleCliHandler, RunModuleCliPayloadSchema } from './autopilot/run-module-cli'

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

  // ============================================================================
  // Autopilot Ops Job Templates
  // ============================================================================

  registry.register('autopilot.ops.scan', opsScanHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => OpsScanPayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.ops.diagnose', opsDiagnoseHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => OpsDiagnosePayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.ops.recommend', opsRecommendHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => OpsRecommendPayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.ops.apply', opsApplyHandler, {
    timeoutMs: 600_000, // 10 minutes for action jobs
    validate: (payload) => OpsApplyPayloadSchema.safeParse(payload).success,
  })

  // ============================================================================
  // Autopilot Support Job Templates
  // ============================================================================

  registry.register('autopilot.support.triage', supportTriageHandler, {
    timeoutMs: 60_000, // 1 minute
    validate: (payload) => SupportTriagePayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.support.draft_reply', supportDraftReplyHandler, {
    timeoutMs: 120_000, // 2 minutes
    validate: (payload) => SupportDraftReplyPayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.support.propose_kb_patch', supportProposeKbPatchHandler, {
    timeoutMs: 180_000, // 3 minutes
    validate: (payload) => SupportProposeKbPatchPayloadSchema.safeParse(payload).success,
  })

  // ============================================================================
  // Autopilot Growth Job Templates
  // ============================================================================

  registry.register('autopilot.growth.seo_scan', growthSeoScanHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => GrowthSeoScanPayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.growth.experiment_propose', growthExperimentProposeHandler, {
    timeoutMs: 120_000, // 2 minutes
    validate: (payload) => GrowthExperimentProposePayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.growth.content_draft', growthContentDraftHandler, {
    timeoutMs: 180_000, // 3 minutes
    validate: (payload) => GrowthContentDraftPayloadSchema.safeParse(payload).success,
  })

  // ============================================================================
  // Autopilot FinOps Job Templates
  // ============================================================================

  registry.register('autopilot.finops.reconcile', finopsReconcileHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => FinopsReconcilePayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.finops.anomaly_scan', finopsAnomalyScanHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => FinopsAnomalyScanPayloadSchema.safeParse(payload).success,
  })

  registry.register('autopilot.finops.churn_risk_report', finopsChurnRiskReportHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => FinopsChurnRiskReportPayloadSchema.safeParse(payload).success,
  })

  // ============================================================================
  // JobForge Bundle Executor (First-class job type)
  // ============================================================================

  registry.register('jobforge.autopilot.execute_request_bundle', executeRequestBundleHandler, {
    timeoutMs: 600_000, // 10 minutes for bundle processing
    validate: (payload) => ExecuteRequestBundlePayloadSchema.safeParse(payload).success,
  })

  registry.register('jobforge.autopilot.run_module_cli', runModuleCliHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => RunModuleCliPayloadSchema.safeParse(payload).success,
  })

  return registry
}

// Export handlers for testing
export { httpRequestHandler, webhookDeliverHandler, reportGenerateHandler }

// Export autopilot handlers for testing
export { opsScanHandler, opsDiagnoseHandler, opsRecommendHandler, opsApplyHandler }

export { supportTriageHandler, supportDraftReplyHandler, supportProposeKbPatchHandler }

export { growthSeoScanHandler, growthExperimentProposeHandler, growthContentDraftHandler }

export { finopsReconcileHandler, finopsAnomalyScanHandler, finopsChurnRiskReportHandler }

export { executeRequestBundleHandler }

export { runModuleCliHandler }
