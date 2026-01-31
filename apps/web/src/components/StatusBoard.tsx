'use client'

import { useApplications } from '@/contexts/ApplicationContext'
import { ApplicationStatus } from '@/types/application'
import { Badge, Card } from '@jobforge/ui'

const columns: { status: ApplicationStatus; label: string; color: string }[] = [
  { status: 'wishlist', label: 'Wishlist', color: 'bg-gray-100' },
  { status: 'applied', label: 'Applied', color: 'bg-blue-100' },
  { status: 'screening', label: 'Screening', color: 'bg-cyan-100' },
  { status: 'interview', label: 'Interview', color: 'bg-yellow-100' },
  { status: 'offer', label: 'Offer', color: 'bg-green-100' },
  { status: 'accepted', label: 'Accepted', color: 'bg-emerald-100' },
  { status: 'rejected', label: 'Rejected', color: 'bg-red-100' },
  { status: 'withdrawn', label: 'Withdrawn', color: 'bg-gray-100' },
]

export function StatusBoard() {
  const { applications, updateApplication, isLoading } = useApplications()

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading board...</div>
      </div>
    )
  }

  const handleStatusChange = (appId: string, newStatus: ApplicationStatus) => {
    updateApplication(appId, { status: newStatus })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Status Board</h1>
          <p className="mt-2 text-gray-600">Kanban view of your applications</p>
        </div>

        <div className="overflow-x-auto">
          <div className="inline-flex gap-4 pb-4 min-w-full">
            {columns.map((column) => {
              const columnApps = applications.filter((app) => app.status === column.status)
              return (
                <div key={column.status} className="flex-shrink-0 w-80">
                  <div className={`${column.color} rounded-t-lg px-4 py-3`}>
                    <div className="flex items-center justify-between">
                      <h2 className="font-semibold text-gray-900">{column.label}</h2>
                      <Badge variant="default">{columnApps.length}</Badge>
                    </div>
                  </div>
                  <div className="bg-gray-100 rounded-b-lg p-4 min-h-[600px] space-y-3">
                    {columnApps.map((app) => (
                      <Card key={app.id} className="cursor-move">
                        <div className="space-y-2">
                          <div>
                            <h3 className="font-semibold text-gray-900 text-sm">{app.position}</h3>
                            <p className="text-xs text-gray-600">{app.companyName}</p>
                          </div>

                          {(app.location || app.salary) && (
                            <div className="text-xs text-gray-500 space-y-1">
                              {app.location && <div>📍 {app.location}</div>}
                              {app.salary && <div>💰 {app.salary}</div>}
                            </div>
                          )}

                          {app.notes && (
                            <p className="text-xs text-gray-600 line-clamp-2">{app.notes}</p>
                          )}

                          <div className="pt-2 border-t border-gray-200">
                            <select
                              value={app.status}
                              onChange={(e) =>
                                handleStatusChange(app.id, e.target.value as ApplicationStatus)
                              }
                              className="w-full text-xs px-2 py-1 border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            >
                              <option value="wishlist">Wishlist</option>
                              <option value="applied">Applied</option>
                              <option value="screening">Screening</option>
                              <option value="interview">Interview</option>
                              <option value="offer">Offer</option>
                              <option value="accepted">Accepted</option>
                              <option value="rejected">Rejected</option>
                              <option value="withdrawn">Withdrawn</option>
                            </select>
                          </div>
                        </div>
                      </Card>
                    ))}

                    {columnApps.length === 0 && (
                      <div className="text-center text-gray-400 py-8 text-sm">No applications</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
