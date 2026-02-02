/**
 * @jobforge/client - Keys example
 * Example usage for the Keys app (API key management)
 */

import { createClient, type EventEnvelope } from '@jobforge/client'

// Create client with configuration
const client = createClient({
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,
  defaultTenantId: process.env.KEYS_TENANT_ID,
})

// Example: Submit API key rotation event
export async function submitKeyRotationEvent(
  keyId: string,
  tenantId: string,
  traceId: string,
  reason: string = 'scheduled'
) {
  const envelope: EventEnvelope = {
    event_version: '1.0',
    event_type: 'keys.key.rotated',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'keys',
    source_module: 'ops',
    subject: {
      type: 'api_key',
      id: keyId,
    },
    payload: {
      key_id: keyId,
      rotation_reason: reason,
      new_key_preview: 'sk-...' + 'abc'.repeat(4), // Masked preview
    },
    contains_pii: true,
    redaction_hints: {
      encrypt_fields: ['new_key_preview'],
      retention_days: 90,
    },
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted key rotation event: ${event.id}`)
  return event
}

// Example: Submit access audit event
export async function submitAccessAuditEvent(
  keyId: string,
  accessedResource: string,
  success: boolean,
  tenantId: string,
  traceId: string
) {
  const envelope: EventEnvelope = {
    event_version: '1.0',
    event_type: 'keys.access.attempt',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'keys',
    source_module: 'core',
    subject: {
      type: 'api_key',
      id: keyId,
    },
    payload: {
      key_id: keyId,
      resource: accessedResource,
      success,
      ip_address: '***', // Redacted
      user_agent: '***', // Redacted
    },
    contains_pii: true,
    redaction_hints: {
      redact_fields: ['ip_address', 'user_agent'],
    },
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted access audit event: ${event.id}`)
  return event
}

// Example: Request security scan job
export async function requestSecurityScan(
  tenantId: string,
  projectId: string,
  scanType: 'full' | 'quick' = 'quick'
) {
  const traceId = `keys-security-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.ops.scan',
    {
      scan_type: scanType,
      scan_targets: ['api_keys', 'service_accounts', 'tokens'],
      check_expiry: true,
      check_permissions: true,
    },
    tenantId,
    projectId,
    traceId,
    `security-scan-${tenantId}-${Date.now()}`
  )

  console.log(`Requested security scan job: ${result.runId}`)
  return result
}

// Example: Request compliance report job
export async function requestComplianceReport(
  tenantId: string,
  reportType: 'soc2' | 'gdpr' | 'pci',
  startDate: string,
  endDate: string
) {
  const traceId = `keys-compliance-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.finops.reconcile',
    {
      report_type: reportType,
      date_range: {
        start: startDate,
        end: endDate,
      },
      include_access_logs: true,
      include_rotation_history: true,
    },
    tenantId,
    'keys-compliance',
    traceId
  )

  console.log(`Requested compliance report job: ${result.runId}`)
  return result
}

// Example: Check security scan results
export async function checkSecurityResults(runId: string, tenantId: string) {
  const status = await client.getRunStatus(runId, tenantId)

  if (status.status === 'completed') {
    const manifest = await client.getRunManifest(runId, tenantId)
    const artifacts = await client.listArtifacts(runId, tenantId)

    // Find the security report artifact
    const reportArtifact = artifacts.artifacts.find(
      (a) => a.name === 'security_report' || a.type === 'report'
    )

    return {
      status,
      manifest,
      artifacts,
      reportArtifact,
      findings: manifest?.outputs.length ?? 0,
    }
  }

  return { status }
}

// Example: Complete key rotation workflow
export async function rotateKeyWorkflow(
  keyId: string,
  tenantId: string,
  reason: string = 'scheduled'
) {
  const traceId = `rotation-${Date.now()}`

  try {
    // 1. Submit rotation event
    await submitKeyRotationEvent(keyId, tenantId, traceId, reason)

    // 2. Submit access audit event
    await submitAccessAuditEvent(keyId, 'key_management_api', true, tenantId, traceId)

    // 3. Request security scan to validate new key
    const scanJob = await requestSecurityScan(tenantId, 'keys-security', 'quick')

    // 4. Poll for scan completion
    let attempts = 0
    const maxAttempts = 60 // 60 seconds

    while (attempts < maxAttempts) {
      const results = await checkSecurityResults(scanJob.runId, tenantId)

      if (results.status?.status === 'completed') {
        console.log(`Security scan completed with ${results.findings} findings`)
        return {
          traceId,
          rotationEvent: true,
          auditEvent: true,
          securityScan: results,
        }
      }

      if (results.status?.status === 'failed') {
        throw new Error('Security scan failed')
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
      attempts++
    }

    throw new Error('Security scan timed out')
  } catch (error) {
    console.error('Key rotation workflow failed:', error)
    throw error
  }
}

// Run example if called directly
if (require.main === module) {
  const tenantId = process.env.KEYS_TENANT_ID || 'keys-demo'
  const keyId = process.argv[2] || 'key-12345'
  const reason = process.argv[3] || 'scheduled_rotation'

  console.log('=== Keys Client Example ===')
  console.log(`Tenant: ${tenantId}`)
  console.log(`Key ID: ${keyId}`)
  console.log(`Reason: ${reason}`)
  console.log(`Integration enabled: ${client.isEnabled()}`)
  console.log(`Dry run mode: ${client.isDryRun()}`)
  console.log('')

  rotateKeyWorkflow(keyId, tenantId, reason)
    .then((result) => {
      console.log('\nWorkflow completed successfully!')
      console.log(`Trace ID: ${result.traceId}`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('\nWorkflow failed:', error)
      process.exit(1)
    })
}
