import http from 'http'

export interface HealthServerOptions {
  port?: number
  isReady?: () => boolean
}

export function startHealthServer(options: HealthServerOptions = {}): http.Server {
  const port =
    options.port ?? (process.env.HEALTH_PORT ? parseInt(process.env.HEALTH_PORT, 10) : 8080)
  const isReady = options.isReady ?? (() => true)

  const server = http.createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }))
      return
    }

    if (req.url === '/readyz') {
      const ready = isReady()
      if (ready) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ready' }))
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'not_ready' }))
      }
      return
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  })

  server.listen(port, () => {
    // optional debug logging
  })

  return server
}
