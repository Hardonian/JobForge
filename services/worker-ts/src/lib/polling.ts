export function calculateNextPollInterval({
  currentIntervalMs,
  baseIntervalMs,
  maxIntervalMs,
  idleBackoffMultiplier,
  jobsClaimed,
}: {
  currentIntervalMs: number
  baseIntervalMs: number
  maxIntervalMs: number
  idleBackoffMultiplier: number
  jobsClaimed: number
}): number {
  if (jobsClaimed > 0) {
    return baseIntervalMs
  }

  const nextInterval = Math.round(currentIntervalMs * idleBackoffMultiplier)
  return Math.max(baseIntervalMs, Math.min(nextInterval, maxIntervalMs))
}
