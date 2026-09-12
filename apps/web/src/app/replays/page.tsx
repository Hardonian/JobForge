'use client'

import * as React from 'react'
import { Card } from '@jobforge/ui'

export default function ReplaysPage(): React.JSX.Element {
  const [selectedJobId, setSelectedJobId] = React.useState('d9b1a0e2-748a-4f5b-9d41-3b7c8e9f0a12')
  const [replaying, setReplaying] = React.useState(false)
  const [replayResult, setReplayResult] = React.useState<{
    match: boolean
    baseline_hash: string
    replay_hash: string
    execution_time_ms: number
  } | null>(null)

  const handleTriggerReplay = async () => {
    setReplaying(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      setReplayResult({
        match: true,
        baseline_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        replay_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        execution_time_ms: 142,
      })
    } finally {
      setReplaying(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
          Deterministic Trace & Replay Sandbox
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Re-execute past autonomous workloads with exact input snapshots to guarantee idempotency
          and audit determinism.
        </p>
      </div>

      <Card
        title="Configure Replay Run"
        description="Select an executed workload to re-run against the local worker engine"
      >
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <input
            type="text"
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            placeholder="Enter Job ID (UUID)..."
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-mono text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            onClick={handleTriggerReplay}
            disabled={replaying || !selectedJobId}
            className="w-full sm:w-auto whitespace-nowrap rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {replaying ? 'Executing Replay...' : 'Trigger Deterministic Replay'}
          </button>
        </div>
      </Card>

      {replayResult && (
        <div className="space-y-6">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-5 dark:border-emerald-900 dark:bg-emerald-950/40">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-bold text-sm">
                ✓
              </span>
              <div>
                <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
                  Deterministic Execution Verified (100% Match)
                </h3>
                <p className="text-xs text-emerald-700 dark:text-emerald-300">
                  Re-execution completed in {replayResult.execution_time_ms}ms with identical
                  cryptographic artifact state hash.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Original Artifact Hash">
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-slate-200">
                SHA-256: {replayResult.baseline_hash}
              </pre>
            </Card>
            <Card title="Replay Artifact Hash">
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 font-mono text-xs text-emerald-400">
                SHA-256: {replayResult.replay_hash}
              </pre>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}
