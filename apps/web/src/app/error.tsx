'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  useEffect(() => {
    console.error('Unhandled error', error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <div className="max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Something went wrong</h1>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400">
          The dashboard hit an unexpected error. Please retry. If the issue persists, contact
          support with the error reference below.
        </p>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
          Error reference: {error.digest ?? 'unknown'}
        </p>
        <button
          className="mt-6 rounded-md bg-black px-4 py-2 text-sm font-semibold text-white"
          onClick={reset}
          type="button"
        >
          Try again
        </button>
      </div>
    </main>
  )
}
