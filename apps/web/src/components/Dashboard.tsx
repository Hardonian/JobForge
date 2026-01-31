'use client'

import { useApplications } from '@/contexts/ApplicationContext'
import { Card } from '@jobforge/ui'
import { ApplicationStatus } from '@/types/application'

interface StatCardProps {
  title: string
  value: number
  subtitle?: string
  icon: React.ReactNode
}

function StatCard({ title, value, subtitle, icon }: StatCardProps) {
  return (
    <Card>
      <div className="flex items-center">
        <div className="flex-shrink-0">{icon}</div>
        <div className="ml-5 w-0 flex-1">
          <dl>
            <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
            <dd>
              <div className="text-3xl font-semibold text-gray-900">{value}</div>
              {subtitle && <div className="text-sm text-gray-500">{subtitle}</div>}
            </dd>
          </dl>
        </div>
      </div>
    </Card>
  )
}

export function Dashboard() {
  const { applications, isLoading } = useApplications()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading dashboard...</div>
      </div>
    )
  }

  const stats = {
    total: applications.length,
    active: applications.filter(
      (app) =>
        app.status === 'applied' ||
        app.status === 'screening' ||
        app.status === 'interview' ||
        app.status === 'offer'
    ).length,
    interviews: applications.filter((app) => app.status === 'interview').length,
    offers: applications.filter((app) => app.status === 'offer').length,
  }

  const statusCounts = applications.reduce(
    (acc, app) => {
      acc[app.status] = (acc[app.status] || 0) + 1
      return acc
    },
    {} as Record<ApplicationStatus, number>
  )

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="mt-2 text-gray-600">Overview of your job search progress</p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <StatCard
            title="Total Applications"
            value={stats.total}
            icon={
              <div className="p-3 bg-blue-500 rounded-full">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
            }
          />

          <StatCard
            title="Active Applications"
            value={stats.active}
            subtitle="In progress"
            icon={
              <div className="p-3 bg-green-500 rounded-full">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
            }
          />

          <StatCard
            title="Interviews"
            value={stats.interviews}
            subtitle="Scheduled"
            icon={
              <div className="p-3 bg-yellow-500 rounded-full">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
              </div>
            }
          />

          <StatCard
            title="Offers"
            value={stats.offers}
            subtitle="Pending"
            icon={
              <div className="p-3 bg-purple-500 rounded-full">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"
                  />
                </svg>
              </div>
            }
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Applications by Status</h2>
            <div className="space-y-3">
              {Object.entries(statusCounts).map(([status, count]) => {
                const countNum = count as number
                const percentage = stats.total > 0 ? (countNum / stats.total) * 100 : 0
                return (
                  <div key={status}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-600 capitalize">{status}</span>
                      <span className="font-medium text-gray-900">{countNum}</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {Object.keys(statusCounts).length === 0 && (
                <p className="text-gray-500 text-center py-4">No applications yet</p>
              )}
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Stats</h2>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Success Rate</span>
                <span className="font-semibold text-gray-900">
                  {stats.total > 0
                    ? `${Math.round(((stats.offers + applications.filter((a) => a.status === 'accepted').length) / stats.total) * 100)}%`
                    : '0%'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Interview Rate</span>
                <span className="font-semibold text-gray-900">
                  {stats.total > 0
                    ? `${Math.round((stats.interviews / stats.total) * 100)}%`
                    : '0%'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">High Priority</span>
                <span className="font-semibold text-gray-900">
                  {applications.filter((a) => a.priority === 'high').length}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">This Week</span>
                <span className="font-semibold text-gray-900">
                  {
                    applications.filter((a) => {
                      if (!a.appliedDate) return false
                      const weekAgo = new Date()
                      weekAgo.setDate(weekAgo.getDate() - 7)
                      return new Date(a.appliedDate) > weekAgo
                    }).length
                  }
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
