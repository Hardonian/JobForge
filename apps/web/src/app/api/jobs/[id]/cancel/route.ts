import { NextRequest, NextResponse } from 'next/server'
import { JobForgeClient } from '@jobforge/sdk-ts'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const tenantId = body.tenant_id || '00000000-0000-0000-0000-000000000001'

  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const client = new JobForgeClient({ supabaseUrl, supabaseKey })
      await client.cancelJob({
        job_id: id,
        tenant_id: tenantId,
      })
      return NextResponse.json({ success: true, message: `Job ${id} cancelled` })
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : String(err) },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ success: true, message: `Job ${id} cancelled` })
}
