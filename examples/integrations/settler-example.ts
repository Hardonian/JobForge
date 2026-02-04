/**
 * Settler Integration Example
 *
 * Demonstrates how to route contract management jobs through JobForge.
 *
 * Settler is a contract lifecycle platform that needs:
 * - Document processing (OCR, parsing, validation)
 * - Notification delivery (email, Slack, webhook)
 * - Report generation (monthly analytics, compliance)
 */

import { JobForgeClient } from '@jobforge/sdk-ts'

// ============================================================================
// Configuration
// ============================================================================

const JOBFORGE_ENABLED = process.env.JOBFORGE_INTEGRATION_ENABLED === '1'
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================================================
// Settler Adapter
// ============================================================================

interface ContractProcessingPayload {
  contract_id: string
  document_url: string
  tenant_id: string
  processing_type: 'ocr' | 'parse' | 'validate' | 'full'
  callback_url?: string
}

interface NotificationPayload {
  tenant_id: string
  contract_id: string
  event_type: 'contract_signed' | 'contract_expiring' | 'payment_due'
  channels: ('email' | 'slack' | 'webhook')[]
  recipients: string[]
}

export class SettlerJobForgeAdapter {
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
   * Queue contract document processing
   */
  async processContract(payload: ContractProcessingPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[Settler] JobForge disabled, processing synchronously')
      return this.processSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'settler.contract.process',
      payload: {
        contract_id: payload.contract_id,
        document_url: payload.document_url,
        tenant_id: payload.tenant_id,
        processing_type: payload.processing_type,
        callback_url: payload.callback_url,
      },
      idempotency_key: `settler-process-${payload.contract_id}`,
    })

    console.log(`[Settler] Queued contract processing: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue notification delivery
   */
  async sendNotification(payload: NotificationPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[Settler] JobForge disabled, sending synchronously')
      return this.notifySync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'settler.notification.send',
      payload: {
        tenant_id: payload.tenant_id,
        contract_id: payload.contract_id,
        event_type: payload.event_type,
        channels: payload.channels,
        recipients: payload.recipients,
      },
      idempotency_key: `settler-notify-${payload.contract_id}-${Date.now()}`,
    })

    console.log(`[Settler] Queued notification: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue monthly report generation
   */
  async generateMonthlyReport(month: string, year: number) {
    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'settler.report.monthly',
      payload: {
        tenant_id: this.tenantId,
        month,
        year,
        report_type: 'contract_analytics',
      },
      idempotency_key: `settler-report-${year}-${month}`,
    })

    console.log(`[Settler] Queued monthly report: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Trigger autopilot contract analysis
   */
  async analyzeContracts(analysisType: 'risk' | 'compliance' | 'efficiency') {
    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'autopilot.ops.scan',
      payload: {
        tenant_id: this.tenantId,
        scan_type: 'contract_analysis',
        analysis_params: {
          type: analysisType,
          scope: 'all_contracts',
        },
      },
      idempotency_key: `settler-analysis-${analysisType}-${Date.now()}`,
    })

    console.log(`[Settler] Queued contract analysis: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  // Fallback synchronous processing
  private async processSync(payload: ContractProcessingPayload) {
    console.log(`[Settler] Processing contract ${payload.contract_id} synchronously`)
    return { job_id: 'sync-' + Date.now(), status: 'completed' }
  }

  private async notifySync(payload: NotificationPayload) {
    console.log(`[Settler] Sending ${payload.event_type} notification synchronously`)
    return { job_id: 'sync-' + Date.now(), status: 'completed' }
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function example() {
  const adapter = new SettlerJobForgeAdapter('tenant-contracts-456')

  // Example 1: Process uploaded contract
  const processing = await adapter.processContract({
    contract_id: 'contract-xyz-789',
    document_url: 'https://storage.example.com/contracts/agreement.pdf',
    tenant_id: 'tenant-contracts-456',
    processing_type: 'full',
    callback_url: 'https://api.settler.example.com/webhooks/processed',
  })

  console.log('Contract processing queued:', processing)

  // Example 2: Send contract signed notification
  const notification = await adapter.sendNotification({
    tenant_id: 'tenant-contracts-456',
    contract_id: 'contract-xyz-789',
    event_type: 'contract_signed',
    channels: ['email', 'slack'],
    recipients: ['legal@example.com', 'ops@example.com'],
  })

  console.log('Notification queued:', notification)

  // Example 3: Generate January 2024 report
  const report = await adapter.generateMonthlyReport('01', 2024)

  console.log('Monthly report queued:', report)

  // Example 4: Run compliance analysis via autopilot
  const analysis = await adapter.analyzeContracts('compliance')

  console.log('Compliance analysis queued:', analysis)
}

// Run if executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example as runSettlerExample }
