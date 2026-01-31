import type { ReactNode } from 'react'

interface VisuallyHiddenProps {
  children: ReactNode
}

/**
 * VisuallyHidden component for screen reader only text.
 * Follows WCAG 2.1 best practices for accessibility.
 */
export function VisuallyHidden({ children }: VisuallyHiddenProps): React.JSX.Element {
  return (
    <span className="sr-only absolute left-[-10000px] top-auto h-px w-px overflow-hidden">
      {children}
    </span>
  )
}
