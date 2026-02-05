#!/usr/bin/env node
/**
 * Benchmark heartbeat frequency for long-running jobs.
 *
 * Usage:
 *   node scripts/worker-heartbeat-benchmark.js --duration-ms=600000 --base-ms=30000 --max-ms=120000 --multiplier=2
 */

function parseArgs() {
  const args = process.argv.slice(2)
  const getArg = (name, fallback) => {
    const found = args.find((arg) => arg.startsWith(`${name}=`))
    return found ? found.split('=')[1] : fallback
  }

  return {
    durationMs: Number(getArg('--duration-ms', '600000')),
    baseMs: Number(getArg('--base-ms', '30000')),
    maxMs: Number(getArg('--max-ms', getArg('--base-ms', '30000'))),
    multiplier: Number(getArg('--multiplier', '2')),
  }
}

function calculateNextHeartbeatInterval({
  currentIntervalMs,
  baseIntervalMs,
  maxIntervalMs,
  backoffMultiplier,
}) {
  const nextInterval = Math.round(currentIntervalMs * backoffMultiplier)
  return Math.max(baseIntervalMs, Math.min(nextInterval, maxIntervalMs))
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  const { durationMs, baseMs, maxMs, multiplier } = parseArgs()

  if ([durationMs, baseMs, maxMs, multiplier].some((value) => Number.isNaN(value))) {
    throw new Error('Invalid numeric argument provided to benchmark.')
  }

  let heartbeatCount = 0
  let currentIntervalMs = baseMs
  const startedAt = Date.now()

  while (Date.now() - startedAt < durationMs) {
    await sleep(currentIntervalMs)
    heartbeatCount += 1
    currentIntervalMs = calculateNextHeartbeatInterval({
      currentIntervalMs,
      baseIntervalMs: baseMs,
      maxIntervalMs: maxMs,
      backoffMultiplier: multiplier,
    })
  }

  const elapsedMs = Date.now() - startedAt
  const heartbeatsPerMinute = (heartbeatCount / elapsedMs) * 60_000

  console.log(
    JSON.stringify({
      duration_ms: elapsedMs,
      heartbeat_count: heartbeatCount,
      heartbeats_per_min: heartbeatsPerMinute,
    })
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
