'use client'

import { useState, FormEvent } from 'react'
import { Button, Input, Select } from '@jobforge/ui'
import { ApplicationFormData, ApplicationStatus, ApplicationPriority } from '@/types/application'
import { useApplications } from '@/contexts/ApplicationContext'

interface ApplicationFormProps {
  onSuccess?: () => void
  onCancel?: () => void
}

export function ApplicationForm({ onSuccess, onCancel }: ApplicationFormProps) {
  const { addApplication } = useApplications()
  const [formData, setFormData] = useState<ApplicationFormData>({
    companyName: '',
    position: '',
    status: 'wishlist',
    priority: 'medium',
    appliedDate: '',
    location: '',
    salary: '',
    jobUrl: '',
    notes: '',
  })

  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}

    if (!formData.companyName.trim()) {
      newErrors.companyName = 'Company name is required'
    }

    if (!formData.position.trim()) {
      newErrors.position = 'Position is required'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    addApplication(formData)

    setFormData({
      companyName: '',
      position: '',
      status: 'wishlist',
      priority: 'medium',
      appliedDate: '',
      location: '',
      salary: '',
      jobUrl: '',
      notes: '',
    })
    setErrors({})

    if (onSuccess) {
      onSuccess()
    }
  }

  const handleChange = (field: keyof ApplicationFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Company Name *"
          value={formData.companyName}
          onChange={(e) => handleChange('companyName', e.target.value)}
          error={errors.companyName}
          placeholder="e.g., Acme Corp"
        />

        <Input
          label="Position *"
          value={formData.position}
          onChange={(e) => handleChange('position', e.target.value)}
          error={errors.position}
          placeholder="e.g., Senior Software Engineer"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="Status"
          value={formData.status}
          onChange={(e) => handleChange('status', e.target.value as ApplicationStatus)}
        >
          <option value="wishlist">Wishlist</option>
          <option value="applied">Applied</option>
          <option value="screening">Screening</option>
          <option value="interview">Interview</option>
          <option value="offer">Offer</option>
          <option value="accepted">Accepted</option>
          <option value="rejected">Rejected</option>
          <option value="withdrawn">Withdrawn</option>
        </Select>

        <Select
          label="Priority"
          value={formData.priority}
          onChange={(e) => handleChange('priority', e.target.value as ApplicationPriority)}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Applied Date"
          type="date"
          value={formData.appliedDate}
          onChange={(e) => handleChange('appliedDate', e.target.value)}
        />

        <Input
          label="Location"
          value={formData.location}
          onChange={(e) => handleChange('location', e.target.value)}
          placeholder="e.g., Remote, New York, NY"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Input
          label="Salary Range"
          value={formData.salary}
          onChange={(e) => handleChange('salary', e.target.value)}
          placeholder="e.g., $120k - $150k"
        />

        <Input
          label="Job URL"
          type="url"
          value={formData.jobUrl}
          onChange={(e) => handleChange('jobUrl', e.target.value)}
          placeholder="https://..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
        <textarea
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          rows={4}
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          placeholder="Additional notes about this application..."
        />
      </div>

      <div className="flex gap-3 justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary">
          Add Application
        </Button>
      </div>
    </form>
  )
}
