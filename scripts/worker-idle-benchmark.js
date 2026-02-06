#!/usr/bin/env node
/**
 * Benchmark idle polling behavior for the TypeScript worker without requiring TS tooling.
 *
 * Usage:
 *   node scripts/worker-idle-benchmark.js --duration-ms=20000 --poll-ms=2000 --max-poll-ms=10000 --multiplier=2
 */

function parseArgs() {
  const args = process.argv.slice(2)
  const getArg = (name, fallback) => {
    const found = args.find((arg) => arg.startsWith(`${name}=`))
    return found ? found.split('=')[1] : fallback
  }

  return {
    durationMs: Number(getArg('--duration-ms', '20000')),
    pollMs: Number(getArg('--poll-ms', '2000')),
    maxPollMs: Number(getArg('--max-poll-ms', getArg('--poll-ms', '2000'))),
    multiplier: Number(getArg('--multiplier', '2')),
  }
}

function calculateNextPollInterval({
  currentIntervalMs,
  baseIntervalMs,
  maxIntervalMs,
  idleBackoffMultiplier,
  jobsClaimed,
}) {
  if (jobsClaimed > 0) {
    return baseIntervalMs
  }

  const nextInterval = Math.round(currentIntervalMs * idleBackoffMultiplier)
  return Math.max(baseIntervalMs, Math.min(nextInterval, maxIntervalMs))
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { durationMs, pollMs, maxPollMs, multiplier } = parseArgs()

  if ([durationMs, pollMs, maxPollMs, multiplier].some((value) => Number.isNaN(value))) {
    throw new Error('Invalid numeric argument provided to benchmark.')
  }

  let claimCount = 0
  let currentIntervalMs = pollMs
  const startedAt = Date.now()

  while (Date.now() - startedAt < durationMs) {
    claimCount += 1
    currentIntervalMs = calculateNextPollInterval({
      currentIntervalMs,
      baseIntervalMs: pollMs,
      maxIntervalMs: maxPollMs,
      idleBackoffMultiplier: multiplier,
      jobsClaimed: 0,
    })
    await sleep(currentIntervalMs)
  }

  const elapsedMs = Date.now() - startedAt
  const claimsPerMinute = (claimCount / elapsedMs) * 60_000

  console.log(
    JSON.stringify({
      duration_ms: elapsedMs,
      claim_count: claimCount,
      claims_per_min: claimsPerMinute,
    })
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
