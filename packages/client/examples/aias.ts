/**
 * @jobforge/client - AIAS example
 * Example usage for the AIAS (AI Automation Service) app
 */

import { createClient, type EventEnvelope } from '@jobforge/client'

// Create client - can use either direct or HTTP transport
const client = createClient({
  // Option 1: Direct transport (same monorepo)
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,

  // Option 2: HTTP transport (if JobForge has HTTP endpoint)
  // apiEndpoint: process.env.JOBFORGE_API_ENDPOINT,
  // apiKey: process.env.JOBFORGE_API_KEY,

  defaultTenantId: process.env.AIAS_TENANT_ID,
})

// Example: Submit AI inference event
export async function submitInferenceEvent(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
  tenantId: string,
  traceId: string
) {
  const envelope: EventEnvelope = {
    event_version: '1.0',
    event_type: 'aias.inference.completed',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'aias',
    source_module: 'core',
    payload: {
      model_id: modelId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      latency_ms: 1234, // Example
      cost_estimate: 0.002,
    },
    contains_pii: false,
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted inference event: ${event.id}`)
  return event
}

// Example: Request AI model fine-tuning job
export async function requestFineTuningJob(
  modelId: string,
  datasetRef: string,
  tenantId: string,
  projectId: string
) {
  const traceId = `aias-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.core.ai_train',
    {
      model_id: modelId,
      dataset_ref: datasetRef,
      training_config: {
        epochs: 3,
        learning_rate: 0.0001,
        batch_size: 32,
      },
    },
    tenantId,
    projectId,
    traceId,
    `finetune-${modelId}-${datasetRef}` // Idempotency key
  )

  console.log(`Requested fine-tuning job: ${result.runId}`)
  return result
}

// Example: Request batch inference job
export async function requestBatchInference(
  modelId: string,
  inputBatchRef: string,
  tenantId: string,
  projectId: string
) {
  const traceId = `aias-batch-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.core.ai_batch',
    {
      model_id: modelId,
      input_batch_ref: inputBatchRef,
      output_format: 'jsonl',
      max_concurrent: 10,
    },
    tenantId,
    projectId,
    traceId
  )

  console.log(`Requested batch inference job: ${result.runId}`)
  return result
}

// Example: Monitor job and retrieve results
export async function monitorJobAndGetResults(
  runId: string,
  tenantId: string,
  maxWaitSeconds: number = 300
) {
  const startTime = Date.now()
  const maxWaitMs = maxWaitSeconds * 1000

  while (Date.now() - startTime < maxWaitMs) {
    const status = await client.getRunStatus(runId, tenantId)

    console.log(`Job ${runId} status: ${status.status} (${status.progress ?? 0}%)`)

    if (status.status === 'completed') {
      // Get manifest with outputs
      const manifest = await client.getRunManifest(runId, tenantId)

      // List artifacts
      const artifacts = await client.listArtifacts(runId, tenantId)

      return {
        status,
        manifest,
        artifacts,
        duration: Date.now() - startTime,
      }
    }

    if (status.status === 'failed') {
      throw new Error(`Job failed: ${status.error?.message}`)
    }

    // Wait 5 seconds between checks
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }

  throw new Error(`Job monitoring timed out after ${maxWaitSeconds}s`)
}

// Example: Complete AI training workflow
export async function trainModelWorkflow(modelId: string, datasetRef: string, tenantId: string) {
  const traceId = `train-${Date.now()}`

  try {
    // 1. Submit inference metrics event
    await submitInferenceEvent(
      modelId,
      1000, // input tokens
      500, // output tokens
      tenantId,
      traceId
    )

    // 2. Request fine-tuning job
    const jobResult = await requestFineTuningJob(modelId, datasetRef, tenantId, 'aias-training')

    // 3. Monitor until complete
    const results = await monitorJobAndGetResults(jobResult.runId, tenantId)

    console.log('Training completed!')
    console.log(`Artifacts: ${results.artifacts.totalCount}`)

    return results
  } catch (error) {
    console.error('Training workflow failed:', error)
    throw error
  }
}

// Run example if called directly
if (require.main === module) {
  const tenantId = process.env.AIAS_TENANT_ID || 'aias-demo'
  const modelId = process.argv[2] || 'gpt-4-demo'
  const datasetRef = process.argv[3] || 'dataset-123'

  console.log('=== AIAS Client Example ===')
  console.log(`Tenant: ${tenantId}`)
  console.log(`Model: ${modelId}`)
  console.log(`Dataset: ${datasetRef}`)
  console.log(`Integration enabled: ${client.isEnabled()}`)
  console.log(`Dry run mode: ${client.isDryRun()}`)
  console.log('')

  trainModelWorkflow(modelId, datasetRef, tenantId)
    .then((results) => {
      console.log('\nWorkflow completed successfully!')
      console.log(`Duration: ${results.duration}ms`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('\nWorkflow failed:', error)
      process.exit(1)
    })
}
