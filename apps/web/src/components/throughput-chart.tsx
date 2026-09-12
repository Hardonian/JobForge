'use client'

import React from 'react'
import { Card } from '@jobforge/ui'

interface Point {
  time: string
  throughput: number
  p95LatencyMs: number
}

const DEFAULT_DATA: Point[] = [
  { time: '12:00', throughput: 120, p95LatencyMs: 42 },
  { time: '12:15', throughput: 185, p95LatencyMs: 45 },
  { time: '12:30', throughput: 290, p95LatencyMs: 58 },
  { time: '12:45', throughput: 240, p95LatencyMs: 50 },
  { time: '13:00', throughput: 380, p95LatencyMs: 65 },
  { time: '13:15', throughput: 420, p95LatencyMs: 62 },
  { time: '13:30', throughput: 310, p95LatencyMs: 48 },
  { time: '13:45', throughput: 275, p95LatencyMs: 44 },
  { time: '14:00', throughput: 350, p95LatencyMs: 52 },
]

export function ThroughputChart({ data = DEFAULT_DATA }: { data?: Point[] }) {
  const maxThroughput = Math.max(...data.map((d) => d.throughput), 500)
  const height = 120
  const width = 480
  const step = width / (data.length - 1)

  const points = data
    .map((d, i) => {
      const x = i * step
      const y = height - (d.throughput / maxThroughput) * (height - 20)
      return `${x},${y}`
    })
    .join(' ')

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">System Throughput & Queue Velocity</h3>
          <p className="text-xs text-muted-foreground">
            Jobs executed per minute over the last 2 hours
          </p>
        </div>
        <div className="flex items-center space-x-4 text-xs">
          <div className="flex items-center space-x-1">
            <span className="w-2.5 h-2.5 bg-blue-500 rounded-full inline-block" />
            <span>Throughput (jobs/min)</span>
          </div>
        </div>
      </div>

      <div className="w-full overflow-hidden">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-32 stroke-blue-500 fill-none">
          <polyline
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points}
          />
        </svg>
      </div>

      <div className="flex justify-between text-xs text-muted-foreground font-mono">
        <span>{data[0]?.time}</span>
        <span>{data[Math.floor(data.length / 2)]?.time}</span>
        <span>{data[data.length - 1]?.time}</span>
      </div>
    </Card>
  )
}
