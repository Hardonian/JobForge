/**
 * Report Generation Connector
 * Generates reports from input data with persistent artifact storage
 */

import type { JobContext } from '@jobforge/shared'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

const ReportGeneratePayloadSchema = z.object({
  report_type: z.string().min(1),
  inputs_ref: z.string().optional(),
  inputs_data: z.record(z.unknown()).optional(),
  format: z.array(z.enum(['json', 'html', 'csv'])).default(['json']),
  options: z.record(z.unknown()).optional(),
})

export type ReportGeneratePayload = z.infer<typeof ReportGeneratePayloadSchema>

export interface ReportGenerateResult {
  report_type: string
  formats: string[]
  report_json: Record<string, unknown>
  report_html?: string
  report_csv?: string
  artifact_ref?: string
  metadata: {
    generated_at: string
    input_count: number
    output_size_bytes: number
  }
}

/**
 * Report generators by type
 */
const reportGenerators: Record<
  string,
  (inputs: Record<string, unknown>, options?: Record<string, unknown>) => Record<string, unknown>
> = {
  'usage-summary': (inputs, _options) => {
    const events = (inputs.events as Array<Record<string, unknown>>) || []

    return {
      total_events: events.length,
      period: inputs.period || 'unknown',
      summary: {
        unique_users: new Set(events.map((e) => e.user_id)).size,
        total_actions: events.length,
      },
      generated_at: new Date().toISOString(),
    }
  },

  'job-analytics': (inputs, _options) => {
    const jobs = (inputs.jobs as Array<Record<string, unknown>>) || []

    const statusCounts = jobs.reduce<Record<string, number>>((acc, job) => {
      const status = String(job.status || 'unknown')
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})

    return {
      total_jobs: jobs.length,
      status_breakdown: statusCounts,
      avg_attempts:
        jobs.reduce((sum, job) => sum + Number(job.attempts || 0), 0) / (jobs.length || 1),
      generated_at: new Date().toISOString(),
    }
  },

  'tenant-usage': (inputs, _options) => {
    const tenantId = inputs.tenant_id
    const jobs = (inputs.jobs as Array<Record<string, unknown>>) || []
    const connectors = (inputs.connectors as Array<Record<string, unknown>>) || []

    return {
      tenant_id: tenantId,
      job_count: jobs.length,
      connector_count: connectors.length,
      period: inputs.period || 'unknown',
      generated_at: new Date().toISOString(),
    }
  },
}

/**
 * Convert JSON report to styled HTML
 */
function jsonToHtml(data: Record<string, unknown>, title: string): string {
  const escapeHtml = (str: string) =>
    str.replace(/[&<>"']/g, (char) => {
      const escapeMap: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      }
      return escapeMap[char] || char
    })

  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return '<em>null</em>'
    if (typeof value === 'object') return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
    return escapeHtml(String(value))
  }

  const rows = Object.entries(data)
    .map(([key, value]) => {
      return `<tr><th>${escapeHtml(key)}</th><td>${renderValue(value)}</td></tr>`
    })
    .join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; padding: 2rem; max-width: 1200px; margin: 0 auto; color: #111; }
    h1 { color: #0f172a; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { padding: 0.75rem; text-align: left; border-bottom: 1px solid #e2e8f0; }
    th { background-color: #f8fafc; font-weight: 600; width: 25%; }
    pre { background: #f1f5f9; padding: 0.5rem; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <table>${rows}</table>
</body>
</html>`
}

/**
 * Convert JSON report to CSV
 */
function jsonToCsv(data: Record<string, unknown>): string {
  const rows = ['Key,Value']

  for (const [key, value] of Object.entries(data)) {
    const valueStr =
      typeof value === 'object' ? JSON.stringify(value).replace(/"/g, '""') : String(value)
    rows.push(`"${key}","${valueStr}"`)
  }

  return rows.join('\n')
}

/**
 * Upload report artifact to Supabase Storage or local persistent fallback
 */
async function uploadReportArtifact(
  tenantId: string,
  jobId: string,
  content: string
): Promise<string> {
  const artifactPath = `reports/${tenantId}/${jobId}.json`
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (supabaseUrl && supabaseKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseKey)
      const bucketName = 'jobforge-artifacts'
      const { error } = await supabase.storage.from(bucketName).upload(artifactPath, content, {
        contentType: 'application/json',
        upsert: true,
      })

      if (!error) {
        return artifactPath
      }
    } catch {
      // Fallback to local storage
    }
  }

  // Local filesystem persistence fallback
  const localDir = path.resolve(process.cwd(), '.artifacts', 'reports', tenantId)
  await fs.mkdir(localDir, { recursive: true })
  const filePath = path.join(localDir, `${jobId}.json`)
  await fs.writeFile(filePath, content, 'utf-8')

  return artifactPath
}

/**
 * Report Generation Handler
 */
export async function reportGenerateHandler(
  payload: unknown,
  context: JobContext
): Promise<ReportGenerateResult> {
  const validated = ReportGeneratePayloadSchema.parse(payload)

  const generator = reportGenerators[validated.report_type]
  if (!generator) {
    throw new Error(`Unknown report type: ${validated.report_type}`)
  }

  let inputsData = validated.inputs_data || {}

  if (validated.inputs_ref && !validated.inputs_data) {
    // Attempt local or storage load if inputs_ref given
    const localRef = path.resolve(process.cwd(), '.artifacts', validated.inputs_ref)
    try {
      const fileData = await fs.readFile(localRef, 'utf-8')
      inputsData = JSON.parse(fileData)
    } catch {
      throw new Error(`inputs_ref ${validated.inputs_ref} could not be resolved from storage`)
    }
  }

  const report_json = generator(inputsData, validated.options)
  const generated_at = new Date().toISOString()

  const result: ReportGenerateResult = {
    report_type: validated.report_type,
    formats: validated.format,
    report_json,
    metadata: {
      generated_at,
      input_count: Object.keys(inputsData).length,
      output_size_bytes: JSON.stringify(report_json).length,
    },
  }

  if (validated.format.includes('html')) {
    result.report_html = jsonToHtml(report_json, `Report: ${validated.report_type}`)
    result.metadata.output_size_bytes += result.report_html.length
  }

  if (validated.format.includes('csv')) {
    result.report_csv = jsonToCsv(report_json)
    result.metadata.output_size_bytes += result.report_csv.length
  }

  // If report exceeds 100KB, persist to storage and record artifact reference
  if (result.metadata.output_size_bytes > 100_000) {
    const reportPayload = JSON.stringify(result)
    result.artifact_ref = await uploadReportArtifact(
      context.tenant_id,
      context.job_id,
      reportPayload
    )
  }

  return result
}
