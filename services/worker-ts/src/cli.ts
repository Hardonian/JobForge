#!/usr/bin/env node
/**
 * JobForge Worker CLI
 */

import type { Logger } from './lib/logger'

const EXIT_CODES = {
  success: 0,
  validation: 2,
  failure: 1,
}

const DEBUG_ENABLED = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

let logger: Logger | null = null

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function logUnexpectedError(message: string, error: unknown): void {
  if (logger) {
    logger.error(message, {
      error: formatError(error),
      stack: DEBUG_ENABLED && error instanceof Error ? error.stack : undefined,
    })
  } else {
    console.error(`${message}: ${formatError(error)}`)
    if (DEBUG_ENABLED && error instanceof Error && error.stack) {
      console.error(error.stack)
    }
  }
}

function showHelp(): void {
  console.log(`
JobForge Worker CLI (TypeScript)

Usage:
  node services/worker-ts/src/cli.ts [options]

Options:
  --once             Run a single poll cycle then exit (default: false)
  --interval=<sec>   Poll interval in seconds (default: 2)
  --help, -h         Show this help and exit

Environment:
  SUPABASE_URL                 Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY    Supabase service role key (required)
  WORKER_ID                    Worker ID (default: worker-<timestamp>)
  POLL_INTERVAL_MS             Poll interval in ms (default: 2000)
  HEARTBEAT_INTERVAL_MS        Heartbeat interval in ms (default: 30000)
  CLAIM_LIMIT                  Max jobs claimed per poll (default: 10)

Examples:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node services/worker-ts/src/cli.ts
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node services/worker-ts/src/cli.ts --once
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node services/worker-ts/src/cli.ts --interval=5
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    showHelp()
    process.exit(EXIT_CODES.success)
  }

  const [{ Worker }, loggerModule, handlersModule] = await Promise.all([
    import('./lib/worker'),
    import('./lib/logger'),
    import('./handlers'),
  ])

  logger = loggerModule.logger
  const createDefaultRegistry = handlersModule.createDefaultRegistry

  // Get config from environment
  const config = {
    workerId: process.env.WORKER_ID || `worker-${Date.now()}`,
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '2000', 10),
    heartbeatIntervalMs: parseInt(process.env.HEARTBEAT_INTERVAL_MS || '30000', 10),
    claimLimit: parseInt(process.env.CLAIM_LIMIT || '10', 10),
  }

  // Validate required config
  if (!config.supabaseUrl || !config.supabaseKey) {
    logger.error('Missing required environment variables', {
      required: ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'],
    })
    process.exit(EXIT_CODES.validation)
  }

  const mode = args.includes('--once') ? 'once' : 'loop'
  const intervalArg = args.find((arg) => arg.startsWith('--interval='))

  if (intervalArg) {
    const interval = parseInt(intervalArg.split('=')[1], 10)
    if (isNaN(interval)) {
      logger.error('Invalid --interval value. Expected a number of seconds.')
      process.exit(EXIT_CODES.validation)
    }
    config.pollIntervalMs = interval * 1000 // Convert to ms
  }

  // Initialize worker with registered handlers
  const registry = createDefaultRegistry()
  const worker = new Worker(config, registry)

  if (mode === 'once') {
    logger.info('Running worker once')
    await worker.runOnce()
    logger.info('Worker completed')
  } else {
    logger.info('Running worker in loop mode')
    await worker.run()
  }
}

main().catch((error) => {
  logUnexpectedError('Worker crashed', error)
  process.exit(EXIT_CODES.failure)
})
