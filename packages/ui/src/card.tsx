import { ReactNode } from 'react'

export interface CardProps {
  children: ReactNode
  className?: string
  onClick?: () => void
}

export function Card({ children, className = '', onClick }: CardProps) {
  const baseStyles = 'bg-white rounded-lg shadow-sm border border-gray-200 p-4'
  const clickableStyles = onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''

  return (
    <div className={`${baseStyles} ${clickableStyles} ${className}`} onClick={onClick}>
      {children}
    </div>
  )
}
