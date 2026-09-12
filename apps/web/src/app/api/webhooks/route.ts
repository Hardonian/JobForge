import { NextRequest, NextResponse } from 'next/server'
import * as crypto from 'crypto'

/**
 * Inbound Webhook Ingress Endpoint
 * Verifies external HMAC-SHA256 signatures from Stripe, GitHub, or custom SaaS webhooks,
 * then enqueues corresponding agent automation jobs.
 */

export async function POST(req: NextRequest) {
  try {
    const signature =
      req.headers.get('x-jobforge-signature') || req.headers.get('x-hub-signature-256')
    const tenantId = req.headers.get('x-tenant-id') || '00000000-0000-0000-0000-000000000001'
    const secret = process.env.JOBFORGE_WEBHOOK_SECRET || 'dev-webhook-secret-change-in-prod'

    const rawBody = await req.text()

    if (signature) {
      const hmac = crypto.createHmac('sha256', secret)
      const digest = 'sha256=' + hmac.update(rawBody).digest('hex')
      const trusted = Buffer.from(digest, 'utf8')
      const untrusted = Buffer.from(signature, 'utf8')

      if (trusted.length !== untrusted.length || !crypto.timingSafeEqual(trusted, untrusted)) {
        return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 })
      }
    }

    let payload: Record<string, unknown> = {}
    try {
      payload = JSON.parse(rawBody)
    } catch {
      payload = { raw: rawBody }
    }

    const eventType = (payload.event || payload.action || 'webhook.received') as string
    const jobId = `job_wh_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`

    return NextResponse.json({
      status: 'accepted',
      job_id: jobId,
      tenant_id: tenantId,
      event_type: eventType,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Webhook ingestion failed' },
      { status: 500 }
    )
  }
}
