export function calculateNextHeartbeatInterval({
  currentIntervalMs,
  baseIntervalMs,
  maxIntervalMs,
  backoffMultiplier,
}: {
  currentIntervalMs: number
  baseIntervalMs: number
  maxIntervalMs: number
  backoffMultiplier: number
}): number {
  const nextInterval = Math.round(currentIntervalMs * backoffMultiplier)
  return Math.max(baseIntervalMs, Math.min(nextInterval, maxIntervalMs))
}
