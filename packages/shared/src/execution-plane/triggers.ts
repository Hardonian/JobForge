/**
 * JobForge Execution Plane - Trigger Types
 * Scheduling triggers for cron and event-driven execution
 */

export type TriggerType = 'cron' | 'event'

/**
 * Trigger definition
 */
export interface Trigger {
  id: string
  tenant_id: string
  project_id: string | null
  trigger_type: TriggerType
  name: string
  /** Cron expression (for cron triggers) */
  cron_expression: string | null
  /** Event type filter (for event triggers) */
  event_type_filter: string | null
  /** Source app filter (for event triggers, optional) */
  event_source_filter: string | null
  /** Target template to execute */
  target_template_key: string
  /** Template inputs to use */
  target_inputs: Record<string, unknown>
  /** Whether trigger is enabled */
  enabled: boolean
  /** Dry run mode */
  dry_run: boolean
  /** Last execution timestamp */
  last_fired_at: string | null
  /** Last job ID created */
  last_job_id: string | null
  /** Total fire count */
  fire_count: number
  created_at: string
  updated_at: string
}

/**
 * Parameters for creating a cron trigger
 */
export interface CreateCronTriggerParams {
  tenant_id: string
  name: string
  cron_expression: string
  target_template_key: string
  target_inputs?: Record<string, unknown>
  project_id?: string
  enabled?: boolean
  dry_run?: boolean
}

/**
 * Parameters for creating an event trigger
 */
export interface CreateEventTriggerParams {
  tenant_id: string
  name: string
  event_type_filter: string
  target_template_key: string
  target_inputs?: Record<string, unknown>
  event_source_filter?: string
  project_id?: string
  enabled?: boolean
  dry_run?: boolean
}

/**
 * Trigger fire result
 */
export interface TriggerFireResult {
  trigger_id: string
  job_id?: string
  fired_at: string
  dry_run: boolean
  error?: string
}
