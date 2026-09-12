'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { StatusBadge, PriorityBadge, Card } from '@jobforge/ui'

export default function JobDetailPage(): React.JSX.Element {
  const params = useParams()
  const jobId = Array.isArray(params.id) ? params.id[0] : params.id
  const [rescheduling, setRescheduling] = React.useState(false)
  const [rescheduleMessage, setRescheduleMessage] = React.useState<string | null>(null)

  const handleReschedule = async () => {
    setRescheduling(true)
    setRescheduleMessage(null)
    try {
      const res = await fetch(`/api/jobs/${jobId}/reschedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ run_at: new Date().toISOString() }),
      })
      if (res.ok) {
        setRescheduleMessage('Job successfully queued for immediate retry.')
      }
    } finally {
      setRescheduling(false)
    }
  }

  // Realistic execution snapshot for inspection
  const jobDetails = {
    id: jobId,
    tenant_id: '00000000-0000-0000-0000-000000000001',
    type: 'autopilot.ops.scan',
    status: 'completed',
    priority: 3,
    attempts: 1,
    max_attempts: 5,
    timeout_ms: 300000,
    created_at: new Date(Date.now() - 3600000).toISOString(),
    locked_by: 'worker-ts-prod-01',
    heartbeat_at: new Date(Date.now() - 3590000).toISOString(),
    finished_at: new Date(Date.now() - 3585000).toISOString(),
    payload: {
      target: 'production-fleet',
      scan_depth: 'full',
      focus_areas: ['infrastructure', 'database_pools', 'worker_concurrency'],
      options: {
        include_telemetry: true,
        trace_sample_rate: 1.0,
      },
    },
    result: {
      status: 'healthy',
      nodes_scanned: 12,
      active_claims: 6,
      orphan_leases_cleared: 0,
      p95_latency_ms: 184,
      issues_identified: [],
    },
    artifacts: [
      {
        name: 'ops_scan_report',
        type: 'json',
        ref: `ops-scan-${jobId}.json`,
        size: 1420,
        mime_type: 'application/json',
      },
      {
        name: 'fleet_summary',
        type: 'markdown',
        ref: `ops-scan-${jobId}.md`,
        size: 850,
        mime_type: 'text/markdown',
      },
    ],
    attempts_history: [
      {
        attempt_no: 1,
        started_at: new Date(Date.now() - 3600000).toISOString(),
        finished_at: new Date(Date.now() - 3585000).toISOString(),
        worker_id: 'worker-ts-prod-01',
        status: 'succeeded',
      },
    ],
  }

  return (
    <div className="space-y-6">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <Link href="/jobs" className="hover:text-slate-800 dark:hover:text-slate-200">
          ← Back to Jobs Explorer
        </Link>
        <span>/</span>
        <span className="font-mono">{jobId}</span>
      </div>

      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
              {jobDetails.type}
            </h1>
            <StatusBadge status={jobDetails.status} />
            <PriorityBadge priority={jobDetails.priority} />
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
            ID: {jobDetails.id} · Tenant: {jobDetails.tenant_id}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleReschedule}
            disabled={rescheduling}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {rescheduling ? 'Rescheduling...' : 'Re-run / Reschedule'}
          </button>
        </div>
      </div>

      {rescheduleMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
          {rescheduleMessage}
        </div>
      )}

      {/* Execution Timeline */}
      <Card title="Execution Timeline & Worker Claim">
        <div className="relative border-l border-slate-200 dark:border-slate-800 ml-4 my-2 space-y-6">
          <div className="relative pl-6">
            <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-700" />
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Enqueued into PostgreSQL Queue
            </p>
            <p className="text-[11px] text-slate-500">
              {new Date(jobDetails.created_at).toLocaleString()}
            </p>
          </div>
          <div className="relative pl-6">
            <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-blue-500 animate-pulse" />
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Claimed Lease by Worker ({jobDetails.locked_by})
            </p>
            <p className="text-[11px] text-slate-500">
              {new Date(jobDetails.heartbeat_at).toLocaleString()}
            </p>
          </div>
          <div className="relative pl-6">
            <span className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full bg-emerald-500" />
            <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Completed Successfully
            </p>
            <p className="text-[11px] text-slate-500">
              {new Date(jobDetails.finished_at).toLocaleString()}
            </p>
          </div>
        </div>
      </Card>

      {/* Payload & Result Split */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Input Payload Snapshot">
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-100">
            {JSON.stringify(jobDetails.payload, null, 2)}
          </pre>
        </Card>
        <Card title="Output Result & Manifest">
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-400">
            {JSON.stringify(jobDetails.result, null, 2)}
          </pre>
        </Card>
      </div>

      {/* Generated Artifacts */}
      <Card title="Generated Artifact Outputs">
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {jobDetails.artifacts.map((artifact) => (
            <div key={artifact.ref} className="py-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {artifact.name}
                </p>
                <p className="text-[11px] text-slate-500 font-mono">
                  Ref: {artifact.ref} ({artifact.size} bytes)
                </p>
              </div>
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                {artifact.mime_type}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
