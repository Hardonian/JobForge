/**
 * ReadyLayer Integration Example
 *
 * Demonstrates how to route CDN/asset optimization jobs through JobForge.
 *
 * ReadyLayer is a content delivery platform that needs:
 * - Asset optimization (transcoding, resizing)
 * - Cache purging
 * - Analytics aggregation
 */

import { JobForgeClient } from '@jobforge/sdk-ts'

// ============================================================================
// Configuration
// ============================================================================

const JOBFORGE_ENABLED = process.env.JOBFORGE_INTEGRATION_ENABLED === '1'
const SUPABASE_URL = process.env.SUPABASE_URL!
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// ============================================================================
// ReadyLayer Adapter
// ============================================================================

interface AssetOptimizationPayload {
  asset_id: string
  source_url: string
  tenant_id: string
  formats: ('webp' | 'avif' | 'jpeg' | 'png')[]
  sizes: number[]
  quality: number
}

interface CachePurgePayload {
  tenant_id: string
  paths: string[]
  purge_all?: boolean
}

export class ReadyLayerJobForgeAdapter {
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
   * Queue asset optimization job
   */
  async optimizeAsset(payload: AssetOptimizationPayload) {
    if (!JOBFORGE_ENABLED) {
      console.log('[ReadyLayer] JobForge disabled, processing synchronously')
      return this.processSync(payload)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'readylayer.asset.optimize',
      payload: {
        asset_id: payload.asset_id,
        source_url: payload.source_url,
        tenant_id: payload.tenant_id,
        formats: payload.formats,
        sizes: payload.sizes,
        quality: payload.quality,
      },
      idempotency_key: `readylayer-optimize-${payload.asset_id}`,
    })

    console.log(`[ReadyLayer] Queued optimization job: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  /**
   * Queue CDN cache purge
   */
  async purgeCache(paths: string[], purgeAll = false) {
    if (!JOBFORGE_ENABLED) {
      console.log('[ReadyLayer] JobForge disabled, purging synchronously')
      return this.purgeSync(paths, purgeAll)
    }

    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'readylayer.cache.purge',
      payload: {
        tenant_id: this.tenantId,
        paths,
        purge_all: purgeAll,
      } as CachePurgePayload,
      idempotency_key: `readylayer-purge-${Date.now()}`,
    })

    console.log(`[ReadyLayer] Queued cache purge: ${job.id}`)
    return { job_id: job.id, status: 'queued', paths }
  }

  /**
   * Queue analytics aggregation
   */
  async aggregateAnalytics(timeRange: { start: string; end: string }) {
    const job = await this.client.enqueueJob({
      tenant_id: this.tenantId,
      type: 'readylayer.analytics.aggregate',
      payload: {
        tenant_id: this.tenantId,
        time_range: timeRange,
      },
      idempotency_key: `readylayer-analytics-${timeRange.start}`,
    })

    console.log(`[ReadyLayer] Queued analytics aggregation: ${job.id}`)
    return { job_id: job.id, status: 'queued' }
  }

  // Fallback synchronous processing
  private async processSync(payload: AssetOptimizationPayload) {
    console.log(`[ReadyLayer] Processing asset ${payload.asset_id} synchronously`)
    return { job_id: 'sync-' + Date.now(), status: 'completed' }
  }

  private async purgeSync(paths: string[], purgeAll: boolean) {
    console.log(`[ReadyLayer] Purging ${paths.length} paths synchronously`)
    return { job_id: 'sync-' + Date.now(), status: 'completed', paths, purge_all: purgeAll }
  }
}

// ============================================================================
// Example Usage
// ============================================================================

async function example() {
  const adapter = new ReadyLayerJobForgeAdapter('tenant-prod-123')

  // Example 1: Optimize uploaded image
  const optimization = await adapter.optimizeAsset({
    asset_id: 'img-abc-123',
    source_url: 'https://cdn.example.com/uploads/photo.jpg',
    tenant_id: 'tenant-prod-123',
    formats: ['webp', 'avif'],
    sizes: [320, 640, 1280, 1920],
    quality: 85,
  })

  console.log('Optimization queued:', optimization)

  // Example 2: Purge cache after content update
  const purge = await adapter.purgeCache(['/blog/new-post', '/api/content/homepage'])

  console.log('Cache purge queued:', purge)

  // Example 3: Daily analytics aggregation
  const analytics = await adapter.aggregateAnalytics({
    start: '2024-01-01T00:00:00Z',
    end: '2024-01-01T23:59:59Z',
  })

  console.log('Analytics queued:', analytics)
}

// Run if executed directly
if (require.main === module) {
  example().catch(console.error)
}

export { example as runReadyLayerExample }
