import { InputHTMLAttributes, forwardRef } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => {
    const baseStyles =
      'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500'
    const errorStyles = error ? 'border-red-500' : 'border-gray-300'

    return (
      <div className="w-full">
        {label && <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>}
        <input ref={ref} className={`${baseStyles} ${errorStyles} ${className}`} {...props} />
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>
    )
  }
)

Input.displayName = 'Input'
