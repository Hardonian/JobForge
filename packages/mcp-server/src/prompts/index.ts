/**
 * JobForge MCP Standard Prompts
 * Exposes predefined agent workflows for debugging and performance analysis.
 */

export interface McpPromptDefinition {
  name: string
  description: string
  arguments: {
    name: string
    description: string
    required: boolean
  }[]
  template: (args: Record<string, string>) => string
}

export const PROMPTS: McpPromptDefinition[] = [
  {
    name: 'debug-failed-job',
    description: 'Diagnose and propose remediation for a failed or dead JobForge job execution.',
    arguments: [
      { name: 'job_id', description: 'The UUID of the failed job', required: true },
      { name: 'include_logs', description: 'Whether to inspect full attempt logs', required: false },
    ],
    template: (args) =>
      `Please inspect failed job ${args.job_id} using JobForge MCP tools (jobforge.jobs.get and jobforge.artifacts.get). ` +
      `Analyze the error stack, check attempt count, inspect tenant quota, and propose a concrete remediation plan.`,
  },
  {
    name: 'analyze-performance',
    description: 'Analyze execution duration and compute bottlenecks for specific job types.',
    arguments: [
      { name: 'job_type', description: 'The job type (e.g. autopilot.ops.scan)', required: true },
      { name: 'time_window', description: 'Analysis timeframe (e.g. 24h, 7d)', required: false },
    ],
    template: (args) =>
      `Analyze the performance metrics for job type "${args.job_type}" over the last ${args.time_window || '24h'}. ` +
      `Identify p95/p99 duration trends, error rates, and suggest handler optimization or timeout adjustments.`,
  },
]

export function listPrompts(): McpPromptDefinition[] {
  return PROMPTS
}

export function getPrompt(name: string): McpPromptDefinition | undefined {
  return PROMPTS.find((p) => p.name === name)
}
