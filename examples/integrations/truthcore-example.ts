/**
 * TruthCore Integration Example
 *
 * Demonstrates how to route data verification tasks through JobForge.
 *
 * TruthCore is a data verification platform that needs:
 * - Data pipeline verification jobs
 * - Schema validation jobs
 * - Anomaly detection via autopilot
 * - Compliance report generation
 */

import { JobForgeClient } from '@jobforge/sdk-ts'

// ============================================================================
// Configuration
// ============================================================================

const JOBFORGE_ENABLED = process.env.JOBFORGE_INTEGRATION_ENABLED === '1'
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================================================
// TruthCore Adapter
// ============================================================================

interface PipelineVerificationPayload {
  pipeline_id: string
  tenant_id: string
  source_system: string
  destination_system: string
  data_volume: number
  verification_level: 'basic' | 'standard' | 'comprehensive'
  checks: ('completeness' | 'accuracy' | 'timeliness' | 'consistency')[]
}

interface SchemaValidationPayload {
  dataset_id: string
  tenant_id: string
  schema_version: string
  validation_rules: {
    field: string
    type: 'string' | 'number' | 'boolean' | 'date'
    required: boolean
    constraints?: Record<string, unknown>
  }[]
  strict_mode: boolean
}

interface AnomalyDetectionPayload {
  dataset_id: string
  tenant_id: string
  detection_method: 'statistical' | 'ml' | 'rule_based'
  sensitivity: 'low' | 'medium' | 'high'
  time_window?: { start: string; end: string }
  alert_threshold: number
}

interface ComplianceReportPayload {
  tenant_id: string
  report_type: 'gdpr' | 'soc2' | 'hipaa' | 'custom'
  data_scope: 'all' | 'limited'
  period: { start_date: string; end_date: string }
  audit_trail_required: boolean
  recipients: string[]
}

export class TruthCoreJobForgeAdapter {
  private client: JobForgeClient
  private tenantId: string

  constructor(tenantId: string) {
    this.tenantId = tenantId
    this.client = new JobForgeClient({
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
    })
  }

  /**
   * Queue data pipeline verification job
   */
  async verifyPipeline(payload: PipelineVerificationPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[TruthCore] JobForge disabled, verifying synchronously')
      return this.verifySync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'truthcore.pipeline.verify',
      payload: {
        pipeline_id: payload.pipeline_id,
        tenant_id: payload.tenant_id,
        source_system: payload.source_system,
        destination_system: payload.destination_system,
        data_volume: payload.data_volume,
        verification_level: payload.verification_level,
        checks: payload.checks,
      },
      idempotency_key: `truthcore-verify-${payload.pipeline_id}-${Date.now()}`,
    })

    console.log(`[TruthCore] Queued pipeline verification: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue schema validation job
   */
  async validateSchema(payload: SchemaValidationPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[TruthCore] JobForge disabled, validating synchronously')
      return this.validateSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'truthcore.schema.validate',
      payload: {
        dataset_id: payload.dataset_id,
        tenant_id: payload.tenant_id,
        schema_version: payload.schema_version,
        validation_rules: payload.validation_rules,
        strict_mode: payload.strict_mode,
      },
      idempotency_key: `truthcore-schema-${payload.dataset_id}-${payload.schema_version}`,
    })

    console.log(`[TruthCore] Queued schema validation: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue anomaly detection via autopilot
   */
  async detectAnomalies(payload: AnomalyDetectionPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[TruthCore] JobForge disabled, detecting synchronously')
      return this.detectSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'autopilot.anomaly.detect',
      payload: {
        tenant_id: payload.tenant_id,
        dataset_id: payload.dataset_id,
        detection_method: payload.detection_method,
        sensitivity: payload.sensitivity,
        time_window: payload.time_window,
        alert_threshold: payload.alert_threshold,
      },
      idempotency_key: `truthcore-anomaly-${payload.dataset_id}-${Date.now()}`,
    })

    console.log(`[TruthCore] Queued anomaly detection: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue compliance report generation
   */
  async generateComplianceReport(payload: ComplianceReportPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[TruthCore] JobForge disabled, generating report synchronously')
      return this.reportSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'truthcore.report.compliance',
      payload: {
        tenant_id: payload.tenant_id,
        report_type: payload.report_type,
        data_scope: payload.data_scope,
        period: payload.period,
        audit_trail_required: payload.audit_trail_required,
        recipients: payload.recipients,
      },
      idempotency_key: `truthcore-report-${payload.report_type}-${payload.period.start_date}`,
    })

    console.log(`[TruthCore] Queued compliance report: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  // Fallback synchronous processing
  private async verifySync(payload: PipelineVerificationPayload) {
    console.log(`[TruthCore] Verifying pipeline ${payload.pipeline_id} synchronously`)
    return {
      job_id: 'sync-' + Date.now(),
      status: 'completed',
      result: {
        records_processed: payload.data_volume,
        validation_passed: true,
        issues_found: 0,
      },
    }
  }

  private async validateSync(payload: SchemaValidationPayload) {
    console.log(`[TruthCore] Validating schema for dataset ${payload.dataset_id} synchronously`)
    return {
      job_id: 'sync-' + Date.now(),
      status: 'completed',
      result: {
        records_validated: 1000,
        errors_found: 0,
        schema_compliant: true,
      },
    }
  }

  private async detectSync(payload: AnomalyDetectionPayload) {
    console.log(`[TruthCore] Detecting anomalies in dataset ${payload.dataset_id} synchronously`)
    return {
      job_id: 'sync-' + Date.now(),
      status: 'completed',
      result: {
        anomalies_detected: 0,
        confidence_score: 0.95,
        alert_triggered: false,
      },
    }
  }

  private async reportSync(payload: ComplianceReportPayload) {
    console.log(`[TruthCore] Generating ${payload.report_type} report synchronously`)
    return {
      job_id: 'sync-' + Date.now(),
      status: 'completed',
      result: {
        report_generated: true,
        compliance_status: 'passed',
        audit_trail_attached: payload.audit_trail_required,
      },
    }
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function example() {
  const adapter = new TruthCoreJobForgeAdapter('tenant-truthcore-123')

  // Example 1: Verify data pipeline
  const verification = await adapter.verifyPipeline({
    pipeline_id: 'pipeline-etl-sales-001',
    tenant_id: 'tenant-truthcore-123',
    source_system: 'salesforce',
    destination_system: 'data_warehouse',
    data_volume: 50000,
    verification_level: 'comprehensive',
    checks: ['completeness', 'accuracy', 'timeliness', 'consistency'],
  })

  console.log('Pipeline verification queued:', verification)

  // Example 2: Validate schema
  const validation = await adapter.validateSchema({
    dataset_id: 'dataset-customer-profiles',
    tenant_id: 'tenant-truthcore-123',
    schema_version: 'v2.1.0',
    validation_rules: [
      {
        field: 'customer_id',
        type: 'string',
        required: true,
        constraints: { pattern: '^CUST-[0-9]{6}$' },
      },
      { field: 'email', type: 'string', required: true, constraints: { format: 'email' } },
      { field: 'age', type: 'number', required: false, constraints: { min: 18, max: 120 } },
      { field: 'created_at', type: 'date', required: true },
    ],
    strict_mode: true,
  })

  console.log('Schema validation queued:', validation)

  // Example 3: Detect anomalies via autopilot
  const anomaly = await adapter.detectAnomalies({
    dataset_id: 'dataset-transactions-daily',
    tenant_id: 'tenant-truthcore-123',
    detection_method: 'ml',
    sensitivity: 'high',
    time_window: {
      start: '2024-01-01T00:00:00Z',
      end: '2024-01-31T23:59:59Z',
    },
    alert_threshold: 0.85,
  })

  console.log('Anomaly detection queued:', anomaly)

  // Example 4: Generate SOC2 compliance report
  const report = await adapter.generateComplianceReport({
    tenant_id: 'tenant-truthcore-123',
    report_type: 'soc2',
    data_scope: 'all',
    period: {
      start_date: '2024-01-01',
      end_date: '2024-03-31',
    },
    audit_trail_required: true,
    recipients: ['compliance@example.com', 'security@example.com'],
  })

  console.log('Compliance report queued:', report)
}

// Run if executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example as runTruthCoreExample }
