import { NextResponse } from 'next/server'

export async function GET(): Promise<NextResponse> {
  // In production, queries jobforge_jobs table aggregate stats
  const metrics = {
    overview: {
      queued: 14,
      running: 6,
      completed_today: 18420,
      failed_today: 28,
      dead_letter: 3,
      throughput_per_minute: 245,
      p95_latency_ms: 184,
      active_workers: 8,
    },
    queues: [
      { type: 'connector.http.request', queued: 5, running: 2, avg_duration_ms: 320 },
      { type: 'connector.http_json_v1', queued: 3, running: 2, avg_duration_ms: 410 },
      { type: 'autopilot.ops.scan', queued: 2, running: 1, avg_duration_ms: 1250 },
      { type: 'autopilot.support.triage', queued: 4, running: 1, avg_duration_ms: 180 },
    ],
    timestamp: new Date().toISOString(),
  }

  return NextResponse.json(metrics)
}
