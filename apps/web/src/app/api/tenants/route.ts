import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  const tenants = [
    {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Default Development Tenant',
      tier: 'enterprise',
      status: 'active',
      quotas: {
        max_concurrency: 50,
        current_concurrency: 6,
        rate_limit_per_minute: 1000,
        daily_job_limit: 100000,
        jobs_processed_today: 18420,
      },
      active_api_keys: 3,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Acme Enterprise SaaS',
      tier: 'enterprise',
      status: 'active',
      quotas: {
        max_concurrency: 100,
        current_concurrency: 12,
        rate_limit_per_minute: 2500,
        daily_job_limit: 500000,
        jobs_processed_today: 64200,
      },
      active_api_keys: 5,
      created_at: '2026-02-15T10:30:00.000Z',
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'DataPulse Analytics',
      tier: 'pro',
      status: 'active',
      quotas: {
        max_concurrency: 10,
        current_concurrency: 2,
        rate_limit_per_minute: 300,
        daily_job_limit: 25000,
        jobs_processed_today: 4120,
      },
      active_api_keys: 2,
      created_at: '2026-04-10T14:15:00.000Z',
    },
  ]

  return NextResponse.json({ tenants })
}
