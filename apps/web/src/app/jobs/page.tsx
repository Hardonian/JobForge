'use client'

import * as React from 'react'
import Link from 'next/link'
import {
  StatusBadge,
  PriorityBadge,
  Card,
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

export default function JobsExplorerPage(): React.JSX.Element {
  const [jobs, setJobs] = React.useState<JobItem[]>([])
  const [filterStatus, setFilterStatus] = React.useState<string>('all')
  const [searchQuery, setSearchQuery] = React.useState<string>('')
  const [loading, setLoading] = React.useState<boolean>(true)

  const loadJobs = React.useCallback(async () => {
    setLoading(true)
    try {
      const url = filterStatus !== 'all' ? `/api/jobs?status=${filterStatus}` : '/api/jobs'
      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        setJobs(data.jobs || [])
      }
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  React.useEffect(() => {
    loadJobs()
  }, [loadJobs])

  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return job.id.toLowerCase().includes(q) || job.type.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
          Jobs Explorer
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Inspect, filter, and trace autonomous job executions across all tenant namespaces.
        </p>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'queued', 'running', 'completed', 'failed', 'dead'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${
                filterStatus === st
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
        <div className="w-full sm:w-72">
          <input
            type="text"
            placeholder="Search by ID or type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
      </div>

      {/* Jobs Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell className="text-center py-8" colSpan={7}>
                  Loading jobs...
                </TableCell>
              </TableRow>
            ) : filteredJobs.length === 0 ? (
              <TableRow>
                <TableCell className="text-center py-8 text-slate-500" colSpan={7}>
                  No jobs match the specified criteria.
                </TableCell>
              </TableRow>
            ) : (
              filteredJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-mono text-xs font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                    >
                      {job.id}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs font-medium text-slate-800 dark:text-slate-200">
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
                    {new Date(job.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/jobs/${job.id}`}
                      className="rounded bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300"
                    >
                      Inspect →
                    </Link>
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
