import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
})

export const metadata: Metadata = {
  title: {
    default: 'JobForge Operator Console',
    template: '%s | JobForge Console',
  },
  description:
    'High-reliability agent router for multi-tenant SaaS. SQL, RPC, and deterministic execution.',
}

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/80">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-center gap-8">
              <Link
                href="/"
                className="flex items-center gap-2.5 font-bold tracking-tight text-slate-900 dark:text-slate-50"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm font-mono text-sm">
                  JF
                </span>
                <span className="text-lg">JobForge</span>
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
                  v0.2.0
                </span>
              </Link>
              <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-300">
                <Link
                  href="/"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  Overview
                </Link>
                <Link
                  href="/jobs"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  Jobs Explorer
                </Link>
                <Link
                  href="/dlq"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  Dead Letter Queue
                </Link>
                <Link
                  href="/tenants"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  Tenants & Quotas
                </Link>
                <Link
                  href="/replays"
                  className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  Replays
                </Link>
              </nav>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Fleet Active · 8 Workers
              </div>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  )
}
