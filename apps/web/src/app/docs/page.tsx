import React from 'react'
import { Card } from '@jobforge/ui/card'
import { Badge } from '@jobforge/ui/badge'

interface EndpointDoc {
  method: 'GET' | 'POST' | 'DELETE'
  path: string
  description: string
  headers: string[]
  params?: string[]
}

const ENDPOINTS: EndpointDoc[] = [
  {
    method: 'GET',
    path: '/api/health',
    description: 'System health check returning node uptime, edge status, and correlation ID.',
    headers: ['X-Correlation-ID (optional)'],
  },
  {
    method: 'GET',
    path: '/api/jobs',
    description: 'List and filter jobs by tenant, status, priority, and pagination parameters.',
    headers: ['X-Tenant-ID (required)', 'Authorization (Bearer token)'],
    params: ['status', 'type', 'limit', 'offset'],
  },
  {
    method: 'POST',
    path: '/api/jobs',
    description: 'Enqueue a single job or batch of jobs atomically into the priority queue.',
    headers: ['X-Tenant-ID (required)', 'Authorization (Bearer token)', 'Content-Type: application/json'],
  },
  {
    method: 'POST',
    path: '/api/jobs/[id]/cancel',
    description: 'Atomically cancel a queued or in-flight job by ID.',
    headers: ['X-Tenant-ID (required)', 'Authorization (Bearer token)'],
  },
  {
    method: 'POST',
    path: '/api/jobs/[id]/reschedule',
    description: 'Reschedule a failed or dead job back to the queued state.',
    headers: ['X-Tenant-ID (required)', 'Authorization (Bearer token)'],
  },
  {
    method: 'GET',
    path: '/api/metrics',
    description: 'Prometheus-formatted and JSON runtime telemetry metrics.',
    headers: ['Accept: text/plain or application/json'],
  },
  {
    method: 'GET',
    path: '/api/tenants',
    description: 'List active tenants and monitor concurrency quota utilization.',
    headers: ['Authorization: Bearer <admin-key>'],
  },
]

export default function ApiDocsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Documentation & Endpoints</h1>
        <p className="text-muted-foreground">
          REST API reference for integrating autonomous agents, CI systems, and external SaaS webhooks.
        </p>
      </div>

      <div className="space-y-4">
        {ENDPOINTS.map((ep) => (
          <Card key={`${ep.method}-${ep.path}`} className="p-6 space-y-3">
            <div className="flex items-center space-x-3">
              <Badge variant={ep.method === 'GET' ? 'neutral' : ep.method === 'POST' ? 'success' : 'danger'}>
                {ep.method}
              </Badge>
              <code className="font-mono text-sm font-semibold">{ep.path}</code>
            </div>
            <p className="text-sm text-muted-foreground">{ep.description}</p>
            <div className="pt-2 text-xs font-mono text-muted-foreground border-t space-y-1">
              <div>
                <span className="font-semibold text-foreground">Headers: </span>
                {ep.headers.join(', ')}
              </div>
              {ep.params && (
                <div>
                  <span className="font-semibold text-foreground">Parameters: </span>
                  {ep.params.join(', ')}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
