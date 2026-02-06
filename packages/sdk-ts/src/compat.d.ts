declare module '@jobforge/integration' {
  export interface TraceContext {
    trace_id: string
    [key: string]: unknown
  }

  export function generateTraceId(): string
}

declare module '@jobforge/observability' {
  export class ObservabilityLogger {
    constructor(config: Record<string, unknown>)
    info(message: string, context?: Record<string, unknown>): void
    warn(message: string, context?: Record<string, unknown>): void
    error(message: string, context?: Record<string, unknown>): void
  }

  export class ObservabilitySpan {
    constructor(config: Record<string, unknown>)
    getLogger(): ObservabilityLogger
    end(status?: string, error?: Error): void
  }
}
