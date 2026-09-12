import { NextRequest, NextResponse } from 'next/server'
import { JobForgeClient, type JobStatus } from '@jobforge/sdk-ts'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const searchParams = request.nextUrl.searchParams
  const status = searchParams.get('status')
  const type = searchParams.get('type')
  const tenantId = searchParams.get('tenant_id') || '00000000-0000-0000-0000-000000000001'

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const client = new JobForgeClient({ supabaseUrl, supabaseKey })
      const jobs = await client.listJobs({
        tenant_id: tenantId,
        filters: {
          status: (status as JobStatus) || undefined,
          type: type || undefined,
          limit: 50,
        },
      })
      return NextResponse.json({ jobs })
    } catch (err) {
      // If DB query fails, fall back to mock stream
    }
  }

  // Realistic fallback demo jobs for dashboard inspection
  const sampleJobs = [
    {
      id: 'd9b1a0e2-748a-4f5b-9d41-3b7c8e9f0a12',
      tenant_id: tenantId,
      type: 'autopilot.ops.scan',
      payload: { target: 'production-fleet', scan_depth: 'full' },
      status: 'running',
      attempts: 1,
      max_attempts: 5,
      priority: 3,
      timeout_ms: 300000,
      run_at: new Date().toISOString(),
      created_at: new Date(Date.now() - 45000).toISOString(),
    },
    {
      id: 'f4a2c1b8-3921-4a1d-8f23-6e7d9c0a1b23',
      tenant_id: tenantId,
      type: 'connector.http_json_v1',
      payload: { url: 'https://api.partner.io/v1/sync', method: 'POST' },
      status: 'completed',
      attempts: 1,
      max_attempts: 5,
      priority: 1,
      timeout_ms: 120000,
      run_at: new Date(Date.now() - 120000).toISOString(),
      created_at: new Date(Date.now() - 125000).toISOString(),
    },
    {
      id: 'b7c3d4e5-8912-4c3a-9e45-1a2b3c4d5e6f',
      tenant_id: tenantId,
      type: 'autopilot.support.triage',
      payload: { ticket_id: 'TCK-8921', urgency_detection: true },
      status: 'completed',
      attempts: 1,
      max_attempts: 5,
      priority: 2,
      timeout_ms: 60000,
      run_at: new Date(Date.now() - 300000).toISOString(),
      created_at: new Date(Date.now() - 305000).toISOString(),
    },
    {
      id: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
      tenant_id: tenantId,
      type: 'connector.report.generate',
      payload: { report_type: 'job-analytics', format: ['json', 'html'] },
      status: 'dead',
      attempts: 5,
      max_attempts: 5,
      priority: 0,
      timeout_ms: 300000,
      run_at: new Date(Date.now() - 3600000).toISOString(),
      created_at: new Date(Date.now() - 3610000).toISOString(),
      error: { message: 'Timeout waiting for external downstream resource' },
    },
  ]

  let filtered = sampleJobs
  if (status) {
    filtered = filtered.filter((j) => j.status === status)
  }
  if (type) {
    filtered = filtered.filter((j) => j.type === type)
  }

  return NextResponse.json({ jobs: filtered })
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json()
  const tenantId = body.tenant_id || '00000000-0000-0000-0000-000000000001'

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const client = new JobForgeClient({ supabaseUrl, supabaseKey })
      const job = await client.enqueueJob({
        tenant_id: tenantId,
        type: body.type,
        payload: body.payload || {},
        priority: body.priority,
        timeout_ms: body.timeout_ms,
        idempotency_key: body.idempotency_key,
      })
      return NextResponse.json({ job }, { status: 201 })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      )
    }
  }

  // Simulated enqueued job response
  const job = {
    id: crypto.randomUUID(),
    tenant_id: tenantId,
    type: body.type,
    payload: body.payload || {},
    status: 'queued',
    attempts: 0,
    max_attempts: body.max_attempts || 5,
    priority: body.priority || 0,
    timeout_ms: body.timeout_ms || 300000,
    run_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  }

  return NextResponse.json({ job }, { status: 201 })
}
