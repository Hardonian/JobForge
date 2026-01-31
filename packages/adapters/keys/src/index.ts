/**
 * @jobforge/adapter-keys
 * JobForge adapter for KEYS (API key management platform)
 */

import { z } from "zod";

/**
 * Job Type: keys.usage.aggregate
 * Aggregate API key usage metrics
 */
export const KeysUsageAggregatePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_ids: z.array(z.string().uuid()).optional(),
  start_date: z.string().datetime(),
  end_date: z.string().datetime(),
  granularity: z.enum(["hour", "day", "week"]).default("day"),
});

export type KeysUsageAggregatePayload = z.infer<typeof KeysUsageAggregatePayloadSchema>;

export interface KeysUsageAggregateResult {
  total_requests: number;
  total_cost: number;
  keys_breakdown: Record<string, { requests: number; cost: number }>;
  period: { start: string; end: string };
}

/**
 * Job Type: keys.quota.check
 * Check and enforce API key quotas
 */
export const KeysQuotaCheckPayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_id: z.string().uuid(),
  enforce: z.boolean().default(false),
  notify_on_threshold: z.number().min(0).max(1).default(0.8),
});

export type KeysQuotaCheckPayload = z.infer<typeof KeysQuotaCheckPayloadSchema>;

export interface KeysQuotaCheckResult {
  key_id: string;
  usage_percentage: number;
  threshold_exceeded: boolean;
  actions_taken: string[];
}

/**
 * Job Type: keys.rotation.schedule
 * Schedule automatic key rotation
 */
export const KeysRotationSchedulePayloadSchema = z.object({
  tenant_id: z.string().uuid(),
  key_id: z.string().uuid(),
  rotation_date: z.string().datetime(),
  notify_before_days: z.number().int().positive().default(7),
  auto_rotate: z.boolean().default(false),
});

export type KeysRotationSchedulePayload = z.infer<typeof KeysRotationSchedulePayloadSchema>;

export interface KeysRotationScheduleResult {
  key_id: string;
  rotation_scheduled: boolean;
  new_key_id?: string;
  notifications_sent: number;
}

export const KEYS_INTEGRATION_EXAMPLE = `
// Schedule key rotation
import { JobForgeClient } from '@jobforge/sdk-ts';

export async function scheduleKeyRotation(keyId: string, rotationDate: Date) {
  const jobforge = new JobForgeClient({
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  });

  const job = await jobforge.enqueueJob({
    tenant_id: getTenantId(),
    type: 'keys.rotation.schedule',
    payload: {
      tenant_id: getTenantId(),
      key_id: keyId,
      rotation_date: rotationDate.toISOString(),
      notify_before_days: 7,
      auto_rotate: true,
    },
    run_at: rotationDate,
  });

  return { job_id: job.id };
}
`;
