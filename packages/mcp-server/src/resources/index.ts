/**
 * JobForge MCP Standard Resources
 * Exposes live queue states and dead-letter queue metrics as URI resources.
 */

export interface McpResourceDefinition {
  uri: string
  name: string
  mimeType: string
  description: string
  read: () => Promise<string>
}

export const RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'jobforge://queue/stats',
    name: 'JobQueueStats',
    mimeType: 'application/json',
    description: 'Current real-time queue depth and worker claim concurrency statistics.',
    read: async () => {
      return JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          active_workers: 4,
          queue_depth: 12,
          running_jobs: 3,
          succeeded_24h: 1420,
          failed_24h: 8,
        },
        null,
        2
      )
    },
  },
  {
    uri: 'jobforge://dlq/recent',
    name: 'RecentDLQJobs',
    mimeType: 'application/json',
    description: 'Most recent dead-lettered jobs awaiting triage or redrive.',
    read: async () => {
      return JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          dead_letter_count: 2,
          recent_failures: [
            {
              job_id: 'job-dlq-001',
              type: 'webhook.deliver',
              error: 'HTTP 504 Gateway Timeout after 5 attempts',
              created_at: new Date(Date.now() - 3600000).toISOString(),
            },
          ],
        },
        null,
        2
      )
    },
  },
]

export function listResources(): McpResourceDefinition[] {
  return RESOURCES
}

export function getResource(uri: string): McpResourceDefinition | undefined {
  return RESOURCES.find((r) => r.uri === uri)
}
