import { createClient } from './src/index'

const client = createClient({
  supabaseUrl: 'http://localhost:54321',
  supabaseKey: 'test-key',
  defaultTenantId: 'smoke-test-tenant',
  dryRun: true,
})

const eventEnvelope = {
  schema_version: '1.0.0',
  event_version: '1.0' as const,
  event_type: 'smoke.test.event',
  occurred_at: new Date().toISOString(),
  trace_id: `smoke-${Date.now()}`,
  tenant_id: 'smoke-test-tenant',
  source_app: 'jobforge' as const,
  source_module: 'core' as const,
  subject: {
    type: 'test',
    id: `test-${Date.now()}`,
  },
  payload: {
    test_name: 'smoke_test',
    test_data: {
      nested: true,
      value: 42,
    },
  },
  contains_pii: false,
}

async function test() {
  try {
    console.log('About to submit...')
    const event = await client.submitEvent(eventEnvelope)
    console.log('Event type:', typeof event)
    console.log('Event keys:', Object.keys(event))
    console.log('Event.id:', event.id)
    console.log('Event.event_type:', event.event_type)
    console.log('Event.processed:', event.processed)
    console.log('Done')
  } catch (e) {
    console.error('Error type:', typeof e)
    console.error('Error:', e)
  }
}

test()
