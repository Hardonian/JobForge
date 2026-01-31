import type { Metadata } from 'next'
import './globals.css'
import '../env'

export const metadata: Metadata = {
  title: 'JobForge',
  description: 'Professional job application tracking and management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
