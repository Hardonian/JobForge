'use client'

import { useState } from 'react'
import { Navigation } from '@/components/Navigation'
import { Dashboard } from '@/components/Dashboard'
import { ApplicationList } from '@/components/ApplicationList'
import { StatusBoard } from '@/components/StatusBoard'

export default function Home() {
  const [activeView, setActiveView] = useState<'dashboard' | 'list' | 'board'>('dashboard')

  return (
    <main>
      <Navigation activeView={activeView} onViewChange={setActiveView} />
      {activeView === 'dashboard' && <Dashboard />}
      {activeView === 'list' && <ApplicationList />}
      {activeView === 'board' && <StatusBoard />}
    </main>
  )
}
