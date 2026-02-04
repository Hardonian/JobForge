import { httpJsonV1Handler } from '../services/worker-ts/src/handlers/http-json-v1'
import { httpRequestHandler } from '../services/worker-ts/src/handlers/http-request'
import { webhookDeliverHandler } from '../services/worker-ts/src/handlers/webhook-deliver'

const iterations = Number(process.env.BENCH_ITERATIONS ?? 50)
const bodySize = Number(process.env.BENCH_BODY_SIZE ?? 2_000_000)

const responseInit = {
  status: 200,
  headers: { 'content-type': 'text/plain', 'x-test': 'ok' },
}

globalThis.fetch = async () => new Response('x'.repeat(bodySize), responseInit)

const context = { trace_id: 'bench', attempt_no: 1 } as any

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[idx]
}

const run = async (
  label: string,
  fn: (payload: any, context: any) => Promise<any>,
  payload: any
) => {
  const durations: number[] = []
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now()
    await fn(payload, context)
    durations.push(performance.now() - start)
  }

  const p50 = percentile(durations, 50).toFixed(2)
  const p95 = percentile(durations, 95).toFixed(2)
  const p99 = percentile(durations, 99).toFixed(2)
  const avg = (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(2)
  console.log(`${label} avg=${avg}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms`)
}

const main = async () => {
  await run('httpJsonV1', httpJsonV1Handler, { url: 'https://example.com/data' })
  await run('httpRequest', httpRequestHandler, { url: 'https://example.com/data' })
  await run('webhookDeliver', webhookDeliverHandler, {
    target_url: 'https://example.com/hook',
    event_type: 'demo',
    event_id: '11111111-1111-4111-8111-111111111111',
    data: { ok: true },
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
