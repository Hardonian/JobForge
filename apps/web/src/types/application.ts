export type ApplicationStatus =
  | 'wishlist'
  | 'applied'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'accepted'
  | 'rejected'
  | 'withdrawn'

export type ApplicationPriority = 'low' | 'medium' | 'high'

export interface Application {
  id: string
  companyName: string
  position: string
  status: ApplicationStatus
  priority: ApplicationPriority
  appliedDate?: string
  location?: string
  salary?: string
  jobUrl?: string
  notes?: string
  contacts?: Contact[]
  activities?: Activity[]
  createdAt: string
  updatedAt: string
}

export interface Contact {
  id: string
  name: string
  role?: string
  email?: string
  phone?: string
  linkedIn?: string
}

export interface Activity {
  id: string
  type: 'note' | 'email' | 'call' | 'interview' | 'followup' | 'other'
  title: string
  description?: string
  date: string
  createdAt: string
}

export interface ApplicationFormData {
  companyName: string
  position: string
  status: ApplicationStatus
  priority: ApplicationPriority
  appliedDate?: string
  location?: string
  salary?: string
  jobUrl?: string
  notes?: string
}
