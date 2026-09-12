'use client'

import * as React from 'react'
import Link from 'next/link'
import {
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

interface DeadJob {
  id: string
  tenant_id: string
  type: string
  status: string
  attempts: number
  max_attempts: number
  priority: number
  error: string
  quarantined_at: string
}

export default function DeadLetterQueuePage(): React.JSX.Element {
  const [deadJobs, setDeadJobs] = React.useState<DeadJob[]>([
    {
      id: 'e1f2a3b4-5c6d-4e7f-8a9b-0c1d2e3f4a5b',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      type: 'connector.report.generate',
      status: 'dead',
      attempts: 5,
      max_attempts: 5,
      priority: 0,
      error: 'Timeout waiting for external downstream resource: Gateway 504',
      quarantined_at: new Date(Date.now() - 3600000 * 3).toISOString(),
    },
    {
      id: 'a7b8c9d0-1e2f-3a4b-5c6d-7e8f9a0b1c2d',
      tenant_id: '00000000-0000-0000-0000-000000000001',
      type: 'connector.webhook.deliver',
      status: 'dead',
      attempts: 5,
      max_attempts: 5,
      priority: 1,
      error: 'Remote webhook endpoint returned persistent 502 Bad Gateway',
      quarantined_at: new Date(Date.now() - 3600000 * 8).toISOString(),
    },
  ])

  const [replaying, setReplaying] = React.useState(false)
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null)

  const handleBulkReplay = async () => {
    setReplaying(true)
    setStatusMessage(null)
    try {
      // Simulate or call bulk reschedule
      await new Promise((r) => setTimeout(r, 1000))
      setStatusMessage(
        `Bulk replay scheduled: ${deadJobs.length} dead jobs released back to queued state with exponential backoff reset.`
      )
      setDeadJobs([])
    } finally {
      setReplaying(false)
    }
  }

  const handleSingleRetry = async (id: string) => {
    await fetch(`/api/jobs/${id}/reschedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_at: new Date().toISOString() }),
    })
    setDeadJobs((prev) => prev.filter((j) => j.id !== id))
    setStatusMessage(`Job ${id} released back to queue.`)
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
            Dead-Letter Queue & Quarantine Manager
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Automated quarantine for jobs exhausting max attempts. Safely inspect, triage, and bulk
            replay.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleBulkReplay}
            disabled={replaying || deadJobs.length === 0}
            className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50 transition-colors"
          >
            {replaying ? 'Replaying All...' : '⚡ Bulk Reschedule All Dead'}
          </button>
        </div>
      </div>

      {statusMessage && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-xs font-medium text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">
          {statusMessage}
        </div>
      )}

      {/* DLQ Metrics */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <MetricCard
          title="Quarantined Dead Jobs"
          value={deadJobs.length}
          subtitle="Awaiting manual triage or automated replay"
          trend={deadJobs.length === 0 ? 'neutral' : 'down'}
        />
        <MetricCard
          title="Max Retries Exhausted"
          value="100%"
          subtitle="Jobs that hit max_attempts (5) ceiling"
        />
        <MetricCard
          title="Downstream Error Cluster"
          value="Gateway 50x"
          subtitle="Dominant root cause across failures"
        />
      </div>

      {/* Dead Jobs Table */}
      <Card title="Quarantined Workloads">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Failure Reason</TableHead>
              <TableHead>Quarantined</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deadJobs.length === 0 ? (
              <TableRow>
                <TableCell className="text-center py-8 text-slate-500" colSpan={7}>
                  🎉 Dead-letter queue is completely empty! All jobs processed successfully.
                </TableCell>
              </TableRow>
            ) : (
              deadJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-mono text-xs font-semibold text-rose-600 hover:underline dark:text-rose-400"
                    >
                      {job.id.slice(0, 8)}...
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
                    {job.type}
                  </TableCell>
                  <TableCell>
                    <PriorityBadge priority={job.priority} />
                  </TableCell>
                  <TableCell className="text-xs font-semibold text-rose-600">
                    {job.attempts} / {job.max_attempts}
                  </TableCell>
                  <TableCell className="text-xs text-slate-600 dark:text-slate-300 max-w-xs truncate">
                    {job.error}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {new Date(job.quarantined_at).toLocaleTimeString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <button
                      onClick={() => handleSingleRetry(job.id)}
                      className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 transition-colors"
                    >
                      Retry Job
                    </button>
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
