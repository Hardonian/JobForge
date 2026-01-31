'use client'

import { useState } from 'react'
import { useApplications } from '@/contexts/ApplicationContext'
import { ApplicationCard } from './ApplicationCard'
import { ApplicationForm } from './ApplicationForm'
import { Button, Select } from '@jobforge/ui'
import { ApplicationStatus } from '@/types/application'

export function ApplicationList() {
  const { applications, isLoading } = useApplications()
  const [showForm, setShowForm] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | 'all'>('all')
  const [searchQuery, setSearchQuery] = useState('')

  const filteredApplications = applications.filter((app) => {
    const matchesStatus = statusFilter === 'all' || app.status === statusFilter
    const matchesSearch =
      searchQuery === '' ||
      app.companyName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      app.position.toLowerCase().includes(searchQuery.toLowerCase())

    return matchesStatus && matchesSearch
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-600">Loading applications...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Job Applications</h1>
            <p className="mt-2 text-gray-600">
              {applications.length} {applications.length === 1 ? 'application' : 'applications'}{' '}
              tracked
            </p>
          </div>
          <Button onClick={() => setShowForm(!showForm)}>
            {showForm ? 'Cancel' : 'Add Application'}
          </Button>
        </div>

        {showForm && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Add New Application</h2>
            <ApplicationForm
              onSuccess={() => setShowForm(false)}
              onCancel={() => setShowForm(false)}
            />
          </div>
        )}

        <div className="mb-6 flex flex-col sm:flex-row gap-4">
          <div className="flex-1">
            <input
              type="text"
              placeholder="Search by company or position..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as ApplicationStatus | 'all')}
            >
              <option value="all">All Statuses</option>
              <option value="wishlist">Wishlist</option>
              <option value="applied">Applied</option>
              <option value="screening">Screening</option>
              <option value="interview">Interview</option>
              <option value="offer">Offer</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="withdrawn">Withdrawn</option>
            </Select>
          </div>
        </div>

        {filteredApplications.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg
                className="mx-auto h-12 w-12"
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
            <p className="text-gray-600 text-lg">
              {searchQuery || statusFilter !== 'all'
                ? 'No applications match your filters'
                : 'No applications yet'}
            </p>
            <p className="text-gray-500 mt-2">
              {searchQuery || statusFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'Get started by adding your first job application'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredApplications.map((app) => (
              <ApplicationCard key={app.id} application={app} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
