/**
 * @jobforge/client - ReadyLayer example
 * Example usage for the ReadyLayer app (infrastructure/cache management)
 */

import { createClient, type EventEnvelope } from '@jobforge/client'

// Create client with HTTP transport option for remote access
const client = createClient({
  // Primary: Direct transport for monorepo
  supabaseUrl: process.env.SUPABASE_URL!,
  supabaseKey: process.env.SUPABASE_SERVICE_KEY!,

  // Alternative: HTTP transport if available
  // apiEndpoint: process.env.JOBFORGE_API_ENDPOINT,
  // apiKey: process.env.JOBFORGE_API_KEY,

  defaultTenantId: process.env.READYLAYER_TENANT_ID,
})

// Example: Submit cache invalidation event
export async function submitCacheInvalidationEvent(
  cacheKey: string,
  invalidationType: 'pattern' | 'exact',
  tenantId: string,
  traceId: string
) {
  const envelope: EventEnvelope = {
    schema_version: '1.0.0',
    event_version: '1.0',
    event_type: 'readylayer.cache.invalidated',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'readylayer',
    source_module: 'ops',
    subject: {
      type: 'cache_entry',
      id: cacheKey,
    },
    payload: {
      cache_key: cacheKey,
      invalidation_type: invalidationType,
      affected_entries: invalidationType === 'pattern' ? -1 : 1, // -1 = unknown count
    },
    contains_pii: false,
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted cache invalidation event: ${event.id}`)
  return event
}

// Example: Submit deployment event
export async function submitDeploymentEvent(
  deploymentId: string,
  environment: string,
  version: string,
  tenantId: string,
  traceId: string
) {
  const envelope: EventEnvelope = {
    schema_version: '1.0.0',
    event_version: '1.0',
    event_type: 'readylayer.deployment.completed',
    occurred_at: new Date().toISOString(),
    trace_id: traceId,
    tenant_id: tenantId,
    source_app: 'readylayer',
    source_module: 'ops',
    subject: {
      type: 'deployment',
      id: deploymentId,
    },
    payload: {
      deployment_id: deploymentId,
      environment,
      version,
      duration_seconds: 120,
      success: true,
    },
    contains_pii: false,
  }

  const event = await client.submitEvent(envelope)
  console.log(`Submitted deployment event: ${event.id}`)
  return event
}

// Example: Request cache warming job
export async function requestCacheWarming(
  cacheKeys: string[],
  priority: 'high' | 'normal' | 'low',
  tenantId: string,
  projectId: string
) {
  const traceId = `readylayer-warm-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.ops.apply',
    {
      operation: 'cache_warm',
      cache_keys: cacheKeys,
      priority,
      batch_size: 100,
      concurrency: 5,
    },
    tenantId,
    projectId,
    traceId,
    `cache-warm-${tenantId}-${Date.now()}`
  )

  console.log(`Requested cache warming job: ${result.runId}`)
  return result
}

// Example: Request infrastructure scan job
export async function requestInfrastructureScan(
  tenantId: string,
  projectId: string,
  resources: string[]
) {
  const traceId = `readylayer-scan-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.ops.scan',
    {
      scan_type: 'infrastructure',
      resources,
      checks: ['health', 'performance', 'cost', 'security'],
      generate_recommendations: true,
    },
    tenantId,
    projectId,
    traceId
  )

  console.log(`Requested infrastructure scan job: ${result.runId}`)
  return result
}

// Example: Request CDN purge job
export async function requestCDNPurge(
  paths: string[],
  tenantId: string,
  projectId: string,
  softPurge: boolean = false
) {
  const traceId = `readylayer-purge-${Date.now()}`

  const result = await client.requestJob(
    'autopilot.ops.apply',
    {
      operation: 'cdn_purge',
      paths,
      soft_purge: softPurge,
      global: true,
    },
    tenantId,
    projectId,
    traceId,
    `cdn-purge-${Date.now()}`
  )

  console.log(`Requested CDN purge job: ${result.runId}`)
  return result
}

// Example: Monitor cache warming progress
export async function monitorCacheWarming(
  runId: string,
  tenantId: string,
  onProgress?: (status: { progress?: number; status: string }) => void
) {
  let completed = false
  let attempts = 0
  const maxAttempts = 120 // 2 minutes

  while (!completed && attempts < maxAttempts) {
    const status = await client.getRunStatus(runId, tenantId)

    onProgress?.({
      progress: status.progress,
      status: status.status,
    })

    if (status.status === 'completed') {
      completed = true
      const artifacts = await client.listArtifacts(runId, tenantId)
      return { status, artifacts, success: true }
    }

    if (status.status === 'failed') {
      throw new Error(`Cache warming failed: ${status.error?.message}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
    attempts++
  }

  if (!completed) {
    throw new Error('Cache warming timed out')
  }
}

// Example: Complete deployment workflow
export async function deploymentWorkflow(
  deploymentId: string,
  environment: string,
  version: string,
  tenantId: string,
  cachePaths: string[] = []
) {
  const traceId = `deploy-${Date.now()}`

  try {
    // 1. Submit deployment event
    await submitDeploymentEvent(deploymentId, environment, version, tenantId, traceId)

    // 2. Purge CDN cache
    const purgeJob = await requestCDNPurge(['/*', ...cachePaths], tenantId, 'readylayer-deploy')

    // 3. Wait for purge to complete
    let purgeCompleted = false
    let attempts = 0
    const maxAttempts = 60

    while (!purgeCompleted && attempts < maxAttempts) {
      const status = await client.getRunStatus(purgeJob.runId, tenantId)

      if (status.status === 'completed') {
        purgeCompleted = true
        console.log('CDN purge completed')
      } else if (status.status === 'failed') {
        throw new Error('CDN purge failed')
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        attempts++
      }
    }

    if (!purgeCompleted) {
      throw new Error('CDN purge timed out')
    }

    // 4. Warm critical caches
    if (cachePaths.length > 0) {
      const warmJob = await requestCacheWarming(cachePaths, 'high', tenantId, 'readylayer-deploy')

      await monitorCacheWarming(warmJob.runId, tenantId, (progress) => {
        console.log(`Cache warming: ${progress.status} (${progress.progress ?? 0}%)`)
      })
    }

    console.log('Deployment workflow completed successfully!')
    return {
      traceId,
      deploymentId,
      environment,
      version,
    }
  } catch (error) {
    console.error('Deployment workflow failed:', error)
    throw error
  }
}

// Run example if called directly
if (require.main === module) {
  const tenantId = process.env.READYLAYER_TENANT_ID || 'readylayer-demo'
  const deploymentId = process.argv[2] || `deploy-${Date.now()}`
  const environment = process.argv[3] || 'staging'
  const version = process.argv[4] || 'v1.0.0'

  console.log('=== ReadyLayer Client Example ===')
  console.log(`Tenant: ${tenantId}`)
  console.log(`Deployment: ${deploymentId}`)
  console.log(`Environment: ${environment}`)
  console.log(`Version: ${version}`)
  console.log(`Integration enabled: ${client.isEnabled()}`)
  console.log(`Dry run mode: ${client.isDryRun()}`)
  console.log('')

  deploymentWorkflow(deploymentId, environment, version, tenantId, ['/api/config', '/static/*'])
    .then((result) => {
      console.log('\nWorkflow completed!')
      console.log(`Trace ID: ${result.traceId}`)
      process.exit(0)
    })
    .catch((error) => {
      console.error('\nWorkflow failed:', error)
      process.exit(1)
    })
}
