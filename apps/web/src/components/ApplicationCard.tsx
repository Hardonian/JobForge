'use client'

import { Application } from '@/types/application'
import { Badge, Card } from '@jobforge/ui'

interface ApplicationCardProps {
  application: Application
  onClick?: () => void
}

const statusColors: Record<
  Application['status'],
  'default' | 'success' | 'warning' | 'danger' | 'info'
> = {
  wishlist: 'default',
  applied: 'info',
  screening: 'info',
  interview: 'warning',
  offer: 'success',
  accepted: 'success',
  rejected: 'danger',
  withdrawn: 'default',
}

const priorityColors: Record<
  Application['priority'],
  'default' | 'success' | 'warning' | 'danger' | 'info'
> = {
  low: 'default',
  medium: 'info',
  high: 'danger',
}

function formatDate(dateString?: string): string {
  if (!dateString) return 'Not set'
  try {
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return 'Invalid date'
  }
}

export function ApplicationCard({ application, onClick }: ApplicationCardProps) {
  return (
    <Card onClick={onClick}>
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 truncate">{application.position}</h3>
            <p className="text-sm text-gray-600 truncate">{application.companyName}</p>
          </div>
          <div className="flex gap-2 ml-2 flex-shrink-0">
            <Badge variant={statusColors[application.status]}>
              {application.status.charAt(0).toUpperCase() + application.status.slice(1)}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm text-gray-500">
          {application.location && (
            <span className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              {application.location}
            </span>
          )}

          {application.salary && (
            <span className="flex items-center gap-1">
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {application.salary}
            </span>
          )}

          <span className="flex items-center gap-1">
            <Badge variant={priorityColors[application.priority]}>
              {application.priority.charAt(0).toUpperCase() + application.priority.slice(1)}{' '}
              Priority
            </Badge>
          </span>
        </div>

        <div className="flex justify-between items-center text-xs text-gray-500 pt-2 border-t border-gray-100">
          <span>Applied: {formatDate(application.appliedDate)}</span>
          <span>Updated: {formatDate(application.updatedAt)}</span>
        </div>
      </div>
    </Card>
  )
}
