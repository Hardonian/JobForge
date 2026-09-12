import * as React from 'react'

export type JobStatus =
  'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'dead' | 'cancelled'

export interface StatusBadgeProps {
  status: JobStatus | string
  className?: string
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps): React.JSX.Element {
  const normalized = status.toLowerCase()

  const colorMap: Record<string, string> = {
    queued:
      'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-300 dark:border-amber-800',
    running:
      'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300 border-blue-300 dark:border-blue-800 animate-pulse',
    completed:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    succeeded:
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
    failed:
      'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 border-rose-300 dark:border-rose-800',
    dead: 'bg-purple-100 text-purple-800 dark:bg-purple-950/50 dark:text-purple-300 border-purple-300 dark:border-purple-800',
    cancelled:
      'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-700',
  }

  const styles =
    colorMap[normalized] ||
    'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border-gray-300'

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${styles} ${className}`}
    >
      <span className="w-1.5 h-1.5 mr-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  )
}

export function PriorityBadge({
  priority,
  className = '',
}: {
  priority: number
  className?: string
}): React.JSX.Element {
  let label = 'Normal'
  let color = 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'

  if (priority >= 3) {
    label = 'Critical'
    color = 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold'
  } else if (priority === 2) {
    label = 'High'
    color = 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
  } else if (priority === 1) {
    label = 'Elevated'
    color = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
  }

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color} ${className}`}
    >
      P{priority} · {label}
    </span>
  )
}
