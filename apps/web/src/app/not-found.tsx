export default function NotFound(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <div className="max-w-2xl text-center">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Page not found</h1>
        <p className="mt-4 text-base text-gray-600 dark:text-gray-400">
          The page you requested does not exist or has moved.
        </p>
        <a className="mt-6 inline-flex text-sm font-semibold text-black" href="/">
          Return to home
        </a>
      </div>
    </main>
  )
}
