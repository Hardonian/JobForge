import { NextRequest, NextResponse } from 'next/server'

function extractCorrelationId(headers: Headers): string | undefined {
  for (const name of ['x-correlation-id', 'x-request-id', 'x-trace-id']) {
    const value = headers.get(name)
    if (value) return value
  }
  return undefined
}

function generateCorrelationId(): string {
  return crypto.randomUUID()
}

/**
 * Next.js middleware for correlation ID tracking.
 * Ensures every request has a unique correlation ID for tracing.
 */
export function middleware(request: NextRequest): NextResponse {
  // Extract existing correlation ID from headers or generate new one
  const correlationId = extractCorrelationId(request.headers) ?? generateCorrelationId()

  // Clone request headers and add correlation ID
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-correlation-id', correlationId)

  // Create response with modified headers
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  })

  // Add correlation ID to response headers for client tracking
  response.headers.set('x-correlation-id', correlationId)

  return response
}

/**
 * Configure middleware to run on all routes except static assets
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public directory)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
