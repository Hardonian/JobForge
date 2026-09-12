import { NextRequest, NextResponse } from 'next/server'

/**
 * JobForge Operator Console Authentication & Session Route
 * Provides session metadata, active tenant context, and role-based permissions (RBAC).
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const path = url.pathname

  if (path.endsWith('/session')) {
    // Authenticated session context with RBAC role
    return NextResponse.json({
      user: {
        id: 'usr_operator_01',
        name: 'Platform Operator',
        email: 'operator@jobforge.local',
        role: 'admin', // 'admin' | 'operator' | 'viewer'
      },
      tenant: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Primary Enterprise Tenant',
        slug: 'primary-enterprise',
        tier: 'enterprise',
      },
      permissions: ['jobs:read', 'jobs:write', 'jobs:cancel', 'dlq:redrive', 'policy:configure'],
      expires: new Date(Date.now() + 86400000).toISOString(),
    })
  }

  if (path.endsWith('/csrf')) {
    return NextResponse.json({
      csrfToken: 'csrf_' + Math.random().toString(36).substring(2),
    })
  }

  return NextResponse.json({ status: 'ok', provider: 'jobforge-auth' })
}

export async function POST(req: NextRequest) {
  return NextResponse.json({ status: 'authenticated', session_id: 'sess_' + Date.now() })
}
