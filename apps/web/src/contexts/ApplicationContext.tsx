'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { Application, ApplicationFormData } from '@/types/application'
import { loadApplications, saveApplications } from '@/lib/storage'

interface ApplicationContextType {
  applications: Application[]
  addApplication: (data: ApplicationFormData) => void
  updateApplication: (id: string, data: Partial<Application>) => void
  deleteApplication: (id: string) => void
  getApplication: (id: string) => Application | undefined
  isLoading: boolean
}

const ApplicationContext = createContext<ApplicationContextType | undefined>(undefined)

export function ApplicationProvider({ children }: { children: ReactNode }) {
  const [applications, setApplications] = useState<Application[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loaded = loadApplications()
    setApplications(loaded)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    if (!isLoading) {
      saveApplications(applications)
    }
  }, [applications, isLoading])

  const addApplication = (data: ApplicationFormData) => {
    const newApplication: Application = {
      ...data,
      id: crypto.randomUUID(),
      contacts: [],
      activities: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setApplications((prev) => [newApplication, ...prev])
  }

  const updateApplication = (id: string, data: Partial<Application>) => {
    setApplications((prev) =>
      prev.map((app) =>
        app.id === id
          ? {
              ...app,
              ...data,
              updatedAt: new Date().toISOString(),
            }
          : app
      )
    )
  }

  const deleteApplication = (id: string) => {
    setApplications((prev) => prev.filter((app) => app.id !== id))
  }

  const getApplication = (id: string) => {
    return applications.find((app) => app.id === id)
  }

  return (
    <ApplicationContext.Provider
      value={{
        applications,
        addApplication,
        updateApplication,
        deleteApplication,
        getApplication,
        isLoading,
      }}
    >
      {children}
    </ApplicationContext.Provider>
  )
}

export function useApplications() {
  const context = useContext(ApplicationContext)
  if (context === undefined) {
    throw new Error('useApplications must be used within an ApplicationProvider')
  }
  return context
}
