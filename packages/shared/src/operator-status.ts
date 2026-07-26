export type JobEvidence = {
  id: string
  status: string
  retryCount?: number
  maxRetries?: number
  error?: string | null
  correlationId?: string | null
  updatedAt?: string
}

export type OperatorStatus = {
  generatedAt: string
  total: number
  byStatus: Record<string, number>
  retryableFailures: Array<{ id: string; retryCount: number; maxRetries: number; error: string }>
  terminalFailures: Array<{ id: string; retryCount: number; maxRetries: number; error: string }>
  jobs: JobEvidence[]
}

export function buildOperatorStatus(jobs: JobEvidence[], now = new Date().toISOString()): OperatorStatus {
  const byStatus: Record<string, number> = {}
  const retryableFailures: OperatorStatus["retryableFailures"] = []
  const terminalFailures: OperatorStatus["terminalFailures"] = []
  for (const job of jobs) {
    byStatus[job.status] = (byStatus[job.status] ?? 0) + 1
    if (job.status !== "failed") continue
    const retryCount = job.retryCount ?? 0
    const maxRetries = job.maxRetries ?? 0
    const item = { id: job.id, retryCount, maxRetries, error: job.error ?? "unknown failure" }
    if (retryCount < maxRetries) retryableFailures.push(item)
    else terminalFailures.push(item)
  }
  return { generatedAt: now, total: jobs.length, byStatus, retryableFailures, terminalFailures, jobs }
}
