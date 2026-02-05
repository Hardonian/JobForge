export default function Home(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-24">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">JobForge</h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
          Agent router for multi-tenant SaaS. Routes workloads through PostgreSQL with SQL, RPC, and
          deterministic execution.
        </p>
      </div>
    </main>
  )
}
