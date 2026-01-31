interface SkipLinkProps {
  href?: string
  children?: string
}

/**
 * Skip link for keyboard navigation.
 * Allows users to skip repetitive navigation and jump to main content.
 */
export function SkipLink({
  href = '#main-content',
  children = 'Skip to main content',
}: SkipLinkProps): React.JSX.Element {
  return (
    <a
      href={href}
      className="sr-only absolute left-4 top-4 z-50 rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white focus:not-sr-only focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
    >
      {children}
    </a>
  )
}
