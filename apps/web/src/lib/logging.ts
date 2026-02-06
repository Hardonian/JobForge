export type LogLevel = 'info' | 'warn' | 'error'

export interface LogContext {
  correlationId?: string
  route?: string
  method?: string
  status?: number
  durationMs?: number
  error?: string
  metadata?: Record<string, unknown>
}

function writeLog(level: LogLevel, message: string, context: LogContext): void {
  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  }

  if (level === 'error') {
    console.error(JSON.stringify(entry))
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry))
  } else {
    console.info(JSON.stringify(entry))
  }
}

export function logInfo(message: string, context: LogContext): void {
  writeLog('info', message, context)
}

export function logWarn(message: string, context: LogContext): void {
  writeLog('warn', message, context)
}

export function logError(message: string, context: LogContext): void {
  writeLog('error', message, context)
}
