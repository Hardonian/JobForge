'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  StatusBadge,
  PriorityBadge,
  Card,
  MetricCard,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@jobforge/ui'

interface JobItem {
  id: string
  tenant_id: string
  type: string
  status: string
  attempts: number
  max_attempts: number
  priority: number
  created_at: string
}

export default function DashboardPage(): React.JSX.Element {
  const [jobs, setJobs] = React.useState<JobItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [enqueueOpen, setEnqueueOpen] = React.useState(false)
  const [newJobType, setNewJobType] = React.useState('autopilot.ops.scan')
  const [newJobPriority, setNewJobPriority] = React.useState(1)
  const [dispatching, setDispatching] = React.useState(false)

  const fetchJobs = React.useCallback(async () => {
    try {
      const res = await fetch('/api/jobs')
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchJobs()
    const timer = setInterval(fetchJobs, 5000)
    return () => clearInterval(timer)
  }, [fetchJobs])

  const handleQuickEnqueue = async (e: React.FormEvent) => {
    e.preventDefault()
    setDispatching(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newJobType,
          priority: newJobPriority,
          payload: { dispatched_from: 'web-dashboard', timestamp: new Date().toISOString() },
        }),
      })
      if (res.ok) {
        setEnqueueOpen(false)
        await fetchJobs()
      }
    } finally {
      setDispatching(false)
    }
  }

  const handleCancelJob = async (jobId: string) => {
    await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
    await fetchJobs()
  }

  return (
    <div className="space-y-8">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Queue Health & Autonomous Workload Fleet
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            PostgreSQL-backed deterministic job queue, worker claims, and autonomous agent
            executions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEnqueueOpen(!enqueueOpen)}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
          >
            + Enqueue Job
          </button>
        </div>
      </div>

      {/* Enqueue Modal Form */}
      {enqueueOpen && (
        <Card
          title="Quick Job Enqueue"
          description="Dispatch an autonomous workload directly into the Postgres claim queue"
        >
          <form onSubmit={handleQuickEnqueue} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Job Type / Connector
              </label>
              <select
                value={newJobType}
                onChange={(e) => setNewJobType(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="autopilot.ops.scan">autopilot.ops.scan</option>
                <option value="autopilot.ops.diagnose">autopilot.ops.diagnose</option>
                <option value="autopilot.support.triage">autopilot.support.triage</option>
                <option value="autopilot.growth.seo_scan">autopilot.growth.seo_scan</option>
                <option value="autopilot.finops.anomaly_scan">autopilot.finops.anomaly_scan</option>
                <option value="connector.http_json_v1">connector.http_json_v1</option>
                <option value="connector.report.generate">connector.report.generate</option>
                <option value="aias.agent.execute">aias.agent.execute</option>
                <option value="settler.contract.process">settler.contract.process</option>
                <option value="keys.quota.check">keys.quota.check</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Priority Tier
              </label>
              <select
                value={newJobPriority}
                onChange={(e) => setNewJobPriority(Number(e.target.value))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={0}>P0 · Standard</option>
                <option value={1}>P1 · Elevated</option>
                <option value={2}>P2 · High</option>
                <option value={3}>P3 · Critical</option>
              </select>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="submit"
                disabled={dispatching}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
              >
                {dispatching ? 'Dispatching...' : 'Dispatch to Queue'}
              </button>
              <button
                type="button"
                onClick={() => setEnqueueOpen(false)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      {/* KPI Metric Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Active Queue Concurrency"
          value="14 Queued"
          change="+4 vs last min"
          trend="up"
          subtitle="6 currently running on TS/Python workers"
        />
        <MetricCard
          title="Cluster Throughput"
          value="245 / min"
          change="+12.4% today"
          trend="up"
          subtitle="Average job processing velocity"
        />
        <MetricCard
          title="Latency (P95)"
          value="184 ms"
          change="-18ms"
          trend="down"
          subtitle="Time from enqueue to worker claim"
        />
        <MetricCard
          title="Execution Success Rate"
          value="99.85%"
          change="3 dead-lettered"
          trend="neutral"
          subtitle="18,420 completed jobs today"
        />
      </div>

      {/* Live Queues Overview & Worker Fleet */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card
          title="Queue Partition Status"
          description="Active load across job handler partitions"
          className="lg:col-span-2"
        >
          <div className="space-y-4">
            {[
              {
                name: 'connector.http_json_v1',
                active: 3,
                running: 2,
                p95: '410ms',
                fill: 'w-[45%]',
              },
              {
                name: 'autopilot.ops.scan',
                active: 2,
                running: 1,
                p95: '1,250ms',
                fill: 'w-[30%]',
              },
              {
                name: 'autopilot.support.triage',
                active: 4,
                running: 1,
                p95: '180ms',
                fill: 'w-[60%]',
              },
              { name: 'aias.agent.execute', active: 5, running: 2, p95: '640ms', fill: 'w-[75%]' },
            ].map((q) => (
              <div key={q.name} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="font-mono text-slate-700 dark:text-slate-300">{q.name}</span>
                  <span className="text-slate-500 dark:text-slate-400">
                    {q.active} queued · {q.running} running · P95: {q.p95}
                  </span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-2 rounded-full bg-indigo-600 ${q.fill}`} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Worker Fleet Nodes" description="Active poll instances & leases">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {[
              {
                id: 'worker-ts-prod-01',
                runtime: 'Node 20 (TS)',
                heartbeat: '2s ago',
                status: 'Healthy',
              },
              {
                id: 'worker-ts-prod-02',
                runtime: 'Node 20 (TS)',
                heartbeat: '4s ago',
                status: 'Healthy',
              },
              {
                id: 'worker-py-prod-01',
                runtime: 'Python 3.11',
                heartbeat: '1s ago',
                status: 'Healthy',
              },
              {
                id: 'worker-py-prod-02',
                runtime: 'Python 3.11',
                heartbeat: '3s ago',
                status: 'Healthy',
              },
            ].map((w) => (
              <div key={w.id} className="py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-xs font-mono font-semibold text-slate-800 dark:text-slate-200">
                    {w.id}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {w.runtime} · {w.heartbeat}
                  </p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {w.status}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent Jobs Table */}
      <Card
        title="Live Streamed Workloads"
        description="Latest autonomous workloads and connector executions across tenant boundaries"
        action={
          <Link
            href="/jobs"
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            View All Jobs →
          </Link>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell className="text-center py-6" colSpan={7}>
                  Loading active job stream...
                </TableCell>
              </TableRow>
            ) : jobs.length === 0 ? (
              <TableRow>
                <TableCell className="text-center py-6" colSpan={7}>
                  No active jobs found in queue.
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-mono text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {job.id.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-800 dark:text-slate-200">
                    {job.type}
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={job.priority || 0} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-xs">
                    {job.attempts} / {job.max_attempts}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {new Date(job.created_at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                      >
                        Inspect
                      </Link>
                      {['queued', 'running'].includes(job.status) && (
                        <button
                          onClick={() => handleCancelJob(job.id)}
                          className="rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:bg-rose-950/50 dark:text-rose-400"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
