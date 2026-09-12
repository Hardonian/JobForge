'use client'

import React, { useState } from 'react'

export interface TenantOption {
  id: string
  name: string
  slug: string
}

const DEFAULT_TENANTS: TenantOption[] = [
  { id: '00000000-0000-0000-0000-000000000001', name: 'Primary Enterprise', slug: 'primary-enterprise' },
  { id: '00000000-0000-0000-0000-000000000002', name: 'Staging E2E Tenant', slug: 'staging-e2e' },
  { id: '00000000-0000-0000-0000-000000000003', name: 'FinOps Pilot Fleet', slug: 'finops-pilot' },
]

export function TenantSelector({
  tenants = DEFAULT_TENANTS,
  onSelect,
}: {
  tenants?: TenantOption[]
  onSelect?: (tenant: TenantOption) => void
}) {
  const [selectedId, setSelectedId] = useState(tenants[0]?.id || '')

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setSelectedId(id)
    const t = tenants.find((x) => x.id === id)
    if (t && onSelect) {
      onSelect(t)
    }
  }

  return (
    <div className="flex items-center space-x-2 text-xs">
      <span className="text-muted-foreground">Tenant:</span>
      <select
        value={selectedId}
        onChange={handleChange}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono"
      >
        {tenants.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.slug})
          </option>
        ))}
      </select>
    </div>
  )
}
