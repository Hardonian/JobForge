/**
 * @jobforge/client - Settler example
 * Example usage for the Settler app
 */

import { createClient, type EventEnvelope } from '@jobforge/client'

// Create client using direct transport (same monorepo)
const client = createClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,
  defaultTenantId: process.env.SETTLER_TENANT_ID,
})

// Example: Submit contract processed event
export async function submitContractProcessedEvent(
  contractId: string,
  tenantId: string,
  traceId: string
) {
  const envelope: EventEnvelope = {
    event_version: '1.0',
    event_type: 'settler.contract.processed',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'settler',
    source_module: 'core',
    subject: {
      type: 'contract',
      id: contractId,
    },
    payload: {
      contract_id: contractId,
      processing_status: 'completed',
      extracted_fields: ['parties', 'terms', 'dates'],
    },
    contains_pii: true, // Contracts may contain PII
    redaction_hints: {
      redact_fields: ['parties.personal_info'],
      retention_days: 2555, // 7 years
    },
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted contract event: ${event.id}`)
  return event
}

// Example: Request contract analysis job
export async function requestContractAnalysis(
  contractId: string,
  tenantId: string,
  projectId: string
) {
  const traceId = `settler-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.ops.scan', // Template key
    {
      contract_id: contractId,
      analysis_type: 'full_review',
      include_risk_assessment: true,
    },
    tenantId,
    projectId,
    traceId,
    `contract-analysis-${contractId}` // Idempotency key
  )

  console.log(`Requested contract analysis job: ${result.runId}`)
  return result
}

// Example: Check analysis status and get artifacts
export async function checkAnalysisStatus(runId: string, tenantId: string) {
  // Get run status
  const status = await client.getRunStatus(runId, tenantId)
  console.log(`Run ${runId} status: ${status.status}`)

  if (status.status === 'completed') {
    // Get manifest
    const manifest = await client.getRunManifest(runId, tenantId)
    console.log(`Manifest outputs: ${manifest?.outputs.length}`)

    // List artifacts
    const artifacts = await client.listArtifacts(runId, tenantId)
    console.log(`Artifacts: ${artifacts.totalCount}`)

    return { status, manifest, artifacts }
  }

  return { status }
}

// Example: Complete workflow
export async function processContractWorkflow(contractId: string, tenantId: string) {
  const traceId = `workflow-${Date.now()}`

  try {
    // 1. Submit event that contract was received
    await submitContractProcessedEvent(contractId, tenantId, traceId)

    // 2. Request analysis job
    const jobResult = await requestContractAnalysis(contractId, tenantId, 'default-project')

    // 3. Poll for completion (simplified - in production use webhooks/queue)
    let attempts = 0
    const maxAttempts = 30

    while (attempts < maxAttempts) {
      const { status } = await checkAnalysisStatus(jobResult.runId, tenantId)

      if (status.status === 'completed') {
        console.log('Contract analysis completed!')
        return jobResult.runId
      }

      if (status.status === 'failed') {
        throw new Error(`Analysis failed: ${status.error?.message}`)
      }

      // Wait 1 second before polling again
      await new Promise((resolve) => setTimeout(resolve, 1000))
      attempts++
    }

    throw new Error('Analysis timed out')
  } catch (error) {
    console.error('Contract workflow failed:', error)
    throw error
  }
}

// Run example if called directly
if (require.main === module) {
  const tenantId = process.env.SETTLER_TENANT_ID || 'demo-tenant'
  const contractId = process.argv[2] || 'demo-contract-123'

  console.log('=== Settler Client Example ===')
  console.log(`Tenant: ${tenantId}`)
  console.log(`Contract: ${contractId}`)
  console.log(`Integration enabled: ${client.isEnabled()}`)
  console.log(`Dry run mode: ${client.isDryRun()}`)
  console.log('')

  processContractWorkflow(contractId, tenantId)
    .then((runId) => {
      console.log(`\nWorkflow completed. Run ID: ${runId}`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('\nWorkflow failed:', error)
      process.exit(1)
    })
}
