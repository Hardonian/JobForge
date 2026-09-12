'use client'

import { useEffect, useState } from 'react'

export interface StreamedJob {
  id: string
  tenant_id: string
  type: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead' | 'canceled'
  attempts: number
  run_at: string
}

export function useJobStream(pollIntervalMs: number = 3000) {
  const [jobs, setJobs] = useState<StreamedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let isMounted = true

    async function fetchJobs() {
      try {
        const res = await fetch('/api/jobs?limit=25')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (isMounted) {
          setJobs(data.jobs || [])
          setError(null)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch jobs')
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchJobs()
    const timer = setInterval(fetchJobs, pollIntervalMs)

    return () => {
      isMounted = false
      clearInterval(timer)
    }
  }, [pollIntervalMs])

  return { jobs, loading, error }
}
