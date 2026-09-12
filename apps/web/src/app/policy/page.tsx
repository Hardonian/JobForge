'use client'

import React, { useState } from 'react'
import { Card } from '@jobforge/ui/card'
import { Badge } from '@jobforge/ui/badge'
import { Button } from '@jobforge/ui/button'

interface PolicyRule {
  domain: string
  level: 'OBSERVE_ONLY' | 'RECOMMEND_ONLY' | 'EXECUTE_ACTION'
  autoApply: boolean
  maxCostPerRun: number
  description: string
}

export default function PolicyGuardPage() {
  const [policies, setPolicies] = useState<PolicyRule[]>([
    {
      domain: 'autopilot.finops',
      level: 'RECOMMEND_ONLY',
      autoApply: false,
      maxCostPerRun: 50.0,
      description: 'FinOps cost anomalies generate recommendations requiring human approval.',
    },
    {
      domain: 'autopilot.ops',
      level: 'EXECUTE_ACTION',
      autoApply: true,
      maxCostPerRun: 10.0,
      description: 'Operational circuit-breaker trips and restart actions execute automatically.',
    },
    {
      domain: 'autopilot.support',
      level: 'RECOMMEND_ONLY',
      autoApply: false,
      maxCostPerRun: 5.0,
      description: 'Draft replies and KB patches require human review prior to customer dispatch.',
    },
    {
      domain: 'autopilot.growth',
      level: 'OBSERVE_ONLY',
      autoApply: false,
      maxCostPerRun: 15.0,
      description: 'SEO audits and marketing copy drafts remain in observation mode.',
    },
  ])

  const [generatedToken, setGeneratedToken] = useState<string | null>(null)

  const handleGenerateToken = (domain: string) => {
    const token = `ptk_${domain.replace('.', '_')}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    setGeneratedToken(token)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Policy Guard Console</h1>
          <p className="text-muted-foreground">
            Configure agent autonomy levels, spending limits, and cryptographic action tokens.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {policies.map((p) => (
          <Card key={p.domain} className="p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-mono font-semibold text-lg">{p.domain}</span>
              <Badge
                variant={
                  p.level === 'EXECUTE_ACTION'
                    ? 'success'
                    : p.level === 'RECOMMEND_ONLY'
                      ? 'warning'
                      : 'neutral'
                }
              >
                {p.level}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{p.description}</p>
            <div className="pt-2 flex items-center justify-between text-xs text-muted-foreground border-t">
              <span>Max Cost: ${p.maxCostPerRun.toFixed(2)}/run</span>
              <span>Auto-Apply: {p.autoApply ? 'Enabled' : 'Disabled'}</span>
            </div>
            <div className="pt-2">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => handleGenerateToken(p.domain)}
              >
                Generate Policy Action Token
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {generatedToken && (
        <Card className="p-6 bg-slate-900 border-emerald-500/50 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-emerald-400">Generated Action Token</span>
            <Badge variant="success">TTL: 1 Hour</Badge>
          </div>
          <code className="block p-3 bg-black/50 rounded font-mono text-xs text-emerald-300 break-all">
            {generatedToken}
          </code>
        </Card>
      )}
    </div>
  )
}
