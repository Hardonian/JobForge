/**
 * JobForge Handler Registry
 * Register all job type handlers here
 */

import { HandlerRegistry } from '../lib/registry'
import { httpRequestHandler } from './http-request'
import { httpJsonV1Handler, HttpJsonRequestSchema } from './http-json-v1'
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

// Adapter handlers
import { aiasAgentExecuteHandler, aiasKnowledgeIndexHandler } from './adapters/aias'
import {
  settlerContractProcessHandler,
  settlerNotificationSendHandler,
  settlerReportMonthlyHandler,
} from './adapters/settler'
import {
  keysUsageAggregateHandler,
  keysQuotaCheckHandler,
  keysRotationScheduleHandler,
} from './adapters/keys'
import {
  AiasAgentExecutePayloadSchema,
  AiasKnowledgeIndexPayloadSchema,
} from '@jobforge/adapter-aias'
import {
  SettlerContractProcessPayloadSchema,
  SettlerNotificationSendPayloadSchema,
  SettlerReportMonthlyPayloadSchema,
} from '@jobforge/adapter-settler'
import {
  KeysUsageAggregatePayloadSchema,
  KeysQuotaCheckPayloadSchema,
  KeysRotationSchedulePayloadSchema,
} from '@jobforge/adapter-keys'

/**
 * Create and configure the default handler registry
 */
export function createDefaultRegistry(): HandlerRegistry {
  const registry = new HandlerRegistry()

  // Register HTTP request handler
  registry.register('connector.http.request', httpRequestHandler, {
    timeoutMs: 60_000, // 1 minute
    validate: (payload) => {
      return typeof payload === 'object' && payload !== null && 'url' in payload
    },
  })

  // Register HTTP JSON v1 connector
  registry.register('connector.http_json_v1', httpJsonV1Handler, {
    timeoutMs: 120_000, // 2 minutes (allows for retries)
    maxAttempts: 5,
    validate: (payload) => {
      const result = HttpJsonRequestSchema.safeParse(payload)
      return result.success
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
  // JobForge Bundle Executor
  // ============================================================================

  registry.register('jobforge.autopilot.execute_request_bundle', executeRequestBundleHandler, {
    timeoutMs: 600_000, // 10 minutes for bundle processing
    validate: (payload) => ExecuteRequestBundlePayloadSchema.safeParse(payload).success,
  })

  registry.register('jobforge.autopilot.run_module_cli', runModuleCliHandler, {
    timeoutMs: 300_000, // 5 minutes
    validate: (payload) => RunModuleCliPayloadSchema.safeParse(payload).success,
  })

  // ============================================================================
  // Adapter Handlers (AIAS, Settler, Keys)
  // ============================================================================

  registry.register('aias.agent.execute', aiasAgentExecuteHandler, {
    timeoutMs: 300_000,
    validate: (payload) => AiasAgentExecutePayloadSchema.safeParse(payload).success,
  })

  registry.register('aias.knowledge.index', aiasKnowledgeIndexHandler, {
    timeoutMs: 300_000,
    validate: (payload) => AiasKnowledgeIndexPayloadSchema.safeParse(payload).success,
  })

  registry.register('settler.contract.process', settlerContractProcessHandler, {
    timeoutMs: 180_000,
    validate: (payload) => SettlerContractProcessPayloadSchema.safeParse(payload).success,
  })

  registry.register('settler.notification.send', settlerNotificationSendHandler, {
    timeoutMs: 60_000,
    validate: (payload) => SettlerNotificationSendPayloadSchema.safeParse(payload).success,
  })

  registry.register('settler.report.monthly', settlerReportMonthlyHandler, {
    timeoutMs: 300_000,
    validate: (payload) => SettlerReportMonthlyPayloadSchema.safeParse(payload).success,
  })

  registry.register('keys.usage.aggregate', keysUsageAggregateHandler, {
    timeoutMs: 180_000,
    validate: (payload) => KeysUsageAggregatePayloadSchema.safeParse(payload).success,
  })

  registry.register('keys.quota.check', keysQuotaCheckHandler, {
    timeoutMs: 60_000,
    validate: (payload) => KeysQuotaCheckPayloadSchema.safeParse(payload).success,
  })

  registry.register('keys.rotation.schedule', keysRotationScheduleHandler, {
    timeoutMs: 60_000,
    validate: (payload) => KeysRotationSchedulePayloadSchema.safeParse(payload).success,
  })

  return registry
}

// Export handlers for testing
export { httpRequestHandler, httpJsonV1Handler }
export { webhookDeliverHandler, reportGenerateHandler }

// Export autopilot handlers for testing
export { opsScanHandler, opsDiagnoseHandler, opsRecommendHandler, opsApplyHandler }
export { supportTriageHandler, supportDraftReplyHandler, supportProposeKbPatchHandler }
export { growthSeoScanHandler, growthExperimentProposeHandler, growthContentDraftHandler }
export { finopsReconcileHandler, finopsAnomalyScanHandler, finopsChurnRiskReportHandler }
export { executeRequestBundleHandler, runModuleCliHandler }

// Export adapter handlers for testing
export { aiasAgentExecuteHandler, aiasKnowledgeIndexHandler }
export {
  settlerContractProcessHandler,
  settlerNotificationSendHandler,
  settlerReportMonthlyHandler,
}
export { keysUsageAggregateHandler, keysQuotaCheckHandler, keysRotationScheduleHandler }
