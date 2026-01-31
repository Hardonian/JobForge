import { Application } from '@/types/application'

const STORAGE_KEY = 'jobforge-applications'

export function loadApplications(): Application[] {
  if (typeof window === 'undefined') return []

  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    return JSON.parse(data)
  } catch (error) {
    console.error('Failed to load applications from storage:', error)
    return []
  }
}

export function saveApplications(applications: Application[]): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(applications))
  } catch (error) {
    console.error('Failed to save applications to storage:', error)
    throw new Error('Failed to save applications')
  }
}

export function clearApplications(): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (error) {
    console.error('Failed to clear applications from storage:', error)
  }
}
