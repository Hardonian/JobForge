'use client'

import * as React from 'react'
import { Card } from '@jobforge/ui'

interface Tenant {
  id: string
  name: string
  tier: string
  status: string
  quotas: {
    max_concurrency: number
    current_concurrency: number
    rate_limit_per_minute: number
    daily_job_limit: number
    jobs_processed_today: number
  }
  active_api_keys: number
  created_at: string
}

export default function TenantsPage(): React.JSX.Element {
  const [tenants, setTenants] = React.useState<Tenant[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    fetch('/api/tenants')
      .then((r) => r.json())
      .then((data) => setTenants(data.tenants || []))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
          Tenant Isolation & Quota Management
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Enforce strict multi-tenant boundaries via PostgreSQL Row Level Security (RLS) and dynamic
          concurrency quotas.
        </p>
      </div>

      {/* RLS Security Invariant Banner */}
      <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-sm">
            ✓
          </span>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
              Database Row Level Security (RLS) Invariant Active
            </h3>
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              All tables (<code className="font-mono">jobforge_jobs</code>,{' '}
              <code className="font-mono">jobforge_job_results</code>,{' '}
              <code className="font-mono">jobforge_api_keys</code>) enforce strict tenant isolation.
              Workers and clients cannot access records outside authorized tenant UUID boundaries.
            </p>
          </div>
        </div>
      </div>

      {/* Tenant Cards */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {loading ? (
          <p className="text-sm text-slate-500">Loading tenant quotas...</p>
        ) : (
          tenants.map((tenant) => {
            const concurrencyPercent = Math.round(
              (tenant.quotas.current_concurrency / tenant.quotas.max_concurrency) * 100
            )
            const dailyPercent = Math.round(
              (tenant.quotas.jobs_processed_today / tenant.quotas.daily_job_limit) * 100
            )

            return (
              <Card
                key={tenant.id}
                title={tenant.name}
                description={`Tier: ${tenant.tier.toUpperCase()} · Status: ${tenant.status}`}
              >
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium mb-1">
                      <span className="text-slate-600 dark:text-slate-400">Concurrency Load</span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {tenant.quotas.current_concurrency} / {tenant.quotas.max_concurrency} (
                        {concurrencyPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-2 rounded-full bg-indigo-600"
                        style={{ width: `${Math.min(concurrencyPercent, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-xs font-medium mb-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Daily Job Throughput
                      </span>
                      <span className="font-mono text-slate-800 dark:text-slate-200">
                        {tenant.quotas.jobs_processed_today.toLocaleString()} /{' '}
                        {tenant.quotas.daily_job_limit.toLocaleString()}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-2 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(dailyPercent, 100)}%` }}
                      />
                    </div>
                  </div>

                  <div className="border-t border-slate-100 dark:border-slate-800 pt-3 text-xs space-y-1 text-slate-500">
                    <p>
                      Rate Limit: {tenant.quotas.rate_limit_per_minute.toLocaleString()} req/min
                    </p>
                    <p>Active API Keys: {tenant.active_api_keys} provisioned</p>
                    <p className="font-mono text-[11px] truncate">UUID: {tenant.id}</p>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* API Key Management Preview */}
      <Card
        title="Tenant API Key Management"
        description="Provisioned cryptographic tokens for client SDK execution"
      >
        <div className="space-y-3">
          {[
            {
              keyName: 'Default Production Agent Key',
              prefix: 'jf_live_79a2...',
              role: 'read_write',
              lastUsed: '3s ago',
            },
            {
              keyName: 'CI/CD Automated Smoke Key',
              prefix: 'jf_live_14bc...',
              role: 'write_only',
              lastUsed: '12m ago',
            },
            {
              keyName: 'Read-Only Observability Exporter',
              prefix: 'jf_live_88d1...',
              role: 'read_only',
              lastUsed: '1m ago',
            },
          ].map((k) => (
            <div
              key={k.prefix}
              className="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-800"
            >
              <div>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {k.keyName}
                </p>
                <p className="text-[11px] font-mono text-slate-500">
                  Key: {k.prefix} · Role: {k.role}
                </p>
              </div>
              <span className="text-xs text-slate-400">Last active: {k.lastUsed}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
