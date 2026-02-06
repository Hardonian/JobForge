import { NextResponse, type NextRequest } from 'next/server'
import { extractCorrelationId, generateCorrelationId } from '@jobforge/errors'
import { checkRateLimit } from '@/lib/rate-limit'
import { logError, logInfo, logWarn } from '@/lib/logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_RATE_LIMIT = Number(process.env.JOBFORGE_HEALTH_RATE_LIMIT ?? 60)
const DEFAULT_RATE_WINDOW_MS = Number(process.env.JOBFORGE_HEALTH_RATE_WINDOW_MS ?? 60_000)

function getClientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown'
  }
  return request.ip ?? 'unknown'
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now()
  const correlationId =
    extractCorrelationId(Object.fromEntries(request.headers.entries())) ?? generateCorrelationId()
  const clientKey = getClientKey(request)

  try {
    const rateLimit = checkRateLimit(
      `health:${clientKey}`,
      DEFAULT_RATE_LIMIT,
      DEFAULT_RATE_WINDOW_MS
    )

    if (!rateLimit.allowed) {
      logWarn('Health check rate limited', {
        correlationId,
        route: '/api/health',
        method: request.method,
        status: 429,
      })

      const retryAfterSeconds = Math.ceil((rateLimit.resetAt - Date.now()) / 1000)
      return NextResponse.json(
        {
          status: 'rate_limited',
          correlationId,
          retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
            'X-Correlation-Id': correlationId,
          },
        }
      )
    }

    const response = NextResponse.json(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        correlationId,
      },
      {
        status: 200,
        headers: {
          'X-Correlation-Id': correlationId,
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(rateLimit.resetAt),
        },
      }
    )

    logInfo('Health check ok', {
      correlationId,
      route: '/api/health',
      method: request.method,
      status: response.status,
      durationMs: Date.now() - start,
    })

    return response
  } catch (error) {
    logError('Health check failed', {
      correlationId,
      route: '/api/health',
      method: request.method,
      status: 500,
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        status: 'error',
        correlationId,
      },
      {
        status: 500,
        headers: {
          'X-Correlation-Id': correlationId,
        },
      }
    )
  }
}
