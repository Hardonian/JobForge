import { SelectHTMLAttributes, forwardRef, ReactNode } from 'react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  children: ReactNode
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, className = '', children, ...props }, ref) => {
    const baseStyles =
      'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
    const errorStyles = error ? 'border-red-500' : 'border-gray-300'

    return (
      <div className="w-full">
        {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
        <select ref={ref} className={`${baseStyles} ${errorStyles} ${className}`} {...props}>
          {children}
        </select>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'
