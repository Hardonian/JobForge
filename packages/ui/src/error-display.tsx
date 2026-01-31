interface ErrorDisplayProps {
  title?: string
  message: string
  code?: string
  correlationId?: string
  retry?: () => void
}

/**
 * Component for displaying error messages with optional retry.
 * Used for controlled error states (not error boundaries).
 */
export function ErrorDisplay({
  title = 'Error',
  message,
  code,
  correlationId,
  retry,
}: ErrorDisplayProps): React.JSX.Element {
  return (
    <div
      className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-400 dark:text-red-500"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800 dark:text-red-200">{title}</h3>
          <div className="mt-2 text-sm text-red-700 dark:text-red-300">
            <p>{message}</p>
          </div>
          {(code || correlationId) && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">
              {code && (
                <span>
                  Code: <code className="font-mono">{code}</code>
                </span>
              )}
              {code && correlationId && <span className="mx-2">•</span>}
              {correlationId && (
                <span>
                  ID: <code className="font-mono">{correlationId}</code>
                </span>
              )}
            </div>
          )}
          {retry && (
            <div className="mt-4">
              <button
                type="button"
                onClick={retry}
                className="rounded-md bg-red-100 px-3 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2 dark:bg-red-900 dark:text-red-200 dark:hover:bg-red-800"
                aria-label="Retry failed operation"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
