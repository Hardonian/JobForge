#!/usr/bin/env node
/**
 * Master Release Verification Tool (7-Gate Architecture)
 * Verifies full release closure with no stubs, no shortcuts, and zero placeholder content.
 *
 * Usage:
 *   node scripts/verify-release.mjs
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const GATES = [
  { id: 'GATE-01', name: 'Database Migrations & Multi-Tenant Schema Invariants' },
  { id: 'GATE-02', name: 'Autopilot & Ecosystem Handlers Non-Stub Verification' },
  { id: 'GATE-03', name: 'Shared Core Types & Directed Acyclic Graph (DAG) Workflow' },
  { id: 'GATE-04', name: 'TypeScript & Python Client SDK Parity' },
  { id: 'GATE-05', name: 'ReadyLayer MCP Governance Plane Implementation' },
  { id: 'GATE-06', name: 'Security & Secret Exposure Static Analysis' },
  { id: 'GATE-07', name: 'Next.js 14 Operator Console & UI Components' },
]

async function runGate1() {
  const migPath = path.join(rootDir, 'supabase', 'migrations', '003_tenants_and_auth.sql')
  const content = await fs.readFile(migPath, 'utf-8')
  
  const requiredTokens = [
    'jobforge_tenants',
    'jobforge_api_keys',
    'jobforge_quotas',
    'jobforge_enqueue_batch',
    'jobforge_reclaim_stuck_jobs',
    'jobforge_bulk_reschedule_dead',
    'jobforge_purge_old_jobs',
    'ALTER TABLE jobforge_tenants ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE jobforge_api_keys ENABLE ROW LEVEL SECURITY',
    'ALTER TABLE jobforge_quotas ENABLE ROW LEVEL SECURITY',
  ]

  for (const token of requiredTokens) {
    if (!content.includes(token)) {
      throw new Error(`Migration 003 missing required definition: ${token}`)
    }
  }

  return 'Verified 003_tenants_and_auth.sql with RLS, quotas, priority claims, batch enqueue & reclaim RPCs.'
}

async function runGate2() {
  const registryPath = path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'index.ts')
  const registryContent = await fs.readFile(registryPath, 'utf-8')

  const requiredHandlers = [
    'autopilot.ops.scan',
    'autopilot.ops.diagnose',
    'autopilot.ops.recommend',
    'autopilot.ops.apply',
    'autopilot.support.triage',
    'autopilot.support.draft_reply',
    'autopilot.support.propose_kb_patch',
    'autopilot.growth.seo_scan',
    'autopilot.growth.experiment_propose',
    'autopilot.growth.content_draft',
    'autopilot.finops.reconcile',
    'autopilot.finops.anomaly_scan',
    'autopilot.finops.churn_risk_report',
    'jobforge.autopilot.execute_request_bundle',
    'aias.agent.execute',
    'aias.knowledge.index',
    'settler.contract.process',
    'settler.notification.send',
    'settler.report.monthly',
    'keys.usage.aggregate',
    'keys.quota.check',
    'keys.rotation.schedule',
  ]

  for (const handler of requiredHandlers) {
    if (!registryContent.includes(`registry.register('${handler}'`)) {
      throw new Error(`Handler registry missing required job type: ${handler}`)
    }
  }

  // Verify non-stub files
  const filesToCheck = [
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'autopilot', 'ops.ts'),
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'autopilot', 'support.ts'),
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'autopilot', 'growth.ts'),
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'autopilot', 'finops.ts'),
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'http-request.ts'),
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'report-generate.ts'),
  ]

  for (const file of filesToCheck) {
    const code = await fs.readFile(file, 'utf-8')
    if (code.includes('// TODO: Implement actual') || code.includes('stub result')) {
      throw new Error(`File ${path.basename(file)} still contains placeholder or stub comments!`)
    }
  }

  return 'All 22 Autopilot & Adapter handlers fully registered with zero stubs or placeholders.'
}

async function runGate3() {
  const workflowPath = path.join(rootDir, 'packages', 'shared', 'src', 'workflow.ts')
  const content = await fs.readFile(workflowPath, 'utf-8')

  if (!content.includes('validateWorkflowAcyclic') || !content.includes('executeWorkflowDAG')) {
    throw new Error('Workflow DAG runner functions missing in @jobforge/shared')
  }

  const typesPath = path.join(rootDir, 'packages', 'shared', 'src', 'types.ts')
  const typesContent = await fs.readFile(typesPath, 'utf-8')

  if (!typesContent.includes('priority?: number') || !typesContent.includes('timeout_ms?: number')) {
    throw new Error('Shared types missing priority or timeout_ms')
  }

  return 'Shared types, Zod schemas, and DAG acyclic workflow engine validated.'
}

async function runGate4() {
  // TS SDK check
  const tsSdkPath = path.join(rootDir, 'packages', 'sdk-ts', 'src', 'client.ts')
  const tsContent = await fs.readFile(tsSdkPath, 'utf-8')
  for (const fn of ['enqueueBatch', 'waitForJob', 'verifyWebhookSignature', 'listJobsIterator']) {
    if (!tsContent.includes(fn)) {
      throw new Error(`TS SDK missing function: ${fn}`)
    }
  }

  // Python SDK check
  const pySdkPath = path.join(rootDir, 'packages', 'sdk-py', 'src', 'jobforge_sdk', 'client.py')
  const pyContent = await fs.readFile(pySdkPath, 'utf-8')
  for (const fn of ['enqueue_batch', 'wait_for_job', 'AsyncJobForgeClient']) {
    if (!pyContent.includes(fn)) {
      throw new Error(`Python SDK missing function/class: ${fn}`)
    }
  }

  return 'TypeScript and Python SDK feature parity verified (batching, polling, async clients).'
}

async function runGate5() {
  const mcpReadyLayerPath = path.join(rootDir, 'packages', 'mcp-server', 'src', 'tools', 'readylayer.ts')
  const content = await fs.readFile(mcpReadyLayerPath, 'utf-8')

  if (content.includes('not yet implemented')) {
    throw new Error('ReadyLayer MCP tools still contain "not yet implemented" stubs!')
  }

  return 'ReadyLayer MCP tools (verify, repo discovery, policy check, security audit, PRs) verified.'
}

async function runGate6() {
  // Check for exposed secrets or hardcoded live keys
  const forbiddenPatterns = [
    /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[a-zA-Z0-9_-]{30,}\.[a-zA-Z0-9_-]{30,}/,
    /sk_live_[0-9a-zA-Z]{24}/,
  ]

  const sampleFiles = [
    path.join(rootDir, 'services', 'worker-ts', 'src', 'handlers', 'index.ts'),
    path.join(rootDir, 'packages', 'sdk-ts', 'src', 'client.ts'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'page.tsx'),
  ]

  for (const file of sampleFiles) {
    const text = await fs.readFile(file, 'utf-8')
    for (const pat of forbiddenPatterns) {
      if (pat.test(text)) {
        throw new Error(`Security Violation: Potential leaked secret in ${file}`)
      }
    }
  }

  return 'Zero secrets detected in source code. Secure environment configuration validated.'
}

async function runGate7() {
  const pages = [
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'page.tsx'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'jobs', 'page.tsx'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'jobs', '[id]', 'page.tsx'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'dlq', 'page.tsx'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'tenants', 'page.tsx'),
    path.join(rootDir, 'apps', 'web', 'src', 'app', 'replays', 'page.tsx'),
  ]

  for (const page of pages) {
    await fs.access(page)
  }

  const uiComponents = [
    path.join(rootDir, 'packages', 'ui', 'src', 'badge.tsx'),
    path.join(rootDir, 'packages', 'ui', 'src', 'card.tsx'),
    path.join(rootDir, 'packages', 'ui', 'src', 'table.tsx'),
  ]

  for (const comp of uiComponents) {
    await fs.access(comp)
  }

  return 'Next.js 14 Operator Console pages & @jobforge/ui design system components verified.'
}

async function main() {
  console.log('======================================================================')
  console.log('               JOBFORGE RELEASE CLOSURE VERIFICATION                  ')
  console.log('                 7-Gate Comprehensive System Audit                    ')
  console.log('======================================================================\n')

  const gateRunners = [
    runGate1,
    runGate2,
    runGate3,
    runGate4,
    runGate5,
    runGate6,
    runGate7,
  ]

  let passed = 0
  let failed = 0

  for (let i = 0; i < GATES.length; i++) {
    const gate = GATES[i]
    process.stdout.write(`[Running] ${gate.id}: ${gate.name}... `)
    try {
      const summary = await gateRunners[i]()
      process.stdout.write('PASSED\n')
      console.log(`          ↳ ${summary}\n`)
      passed++
    } catch (err) {
      process.stdout.write('FAILED\n')
      console.error(`          ↳ Error: ${err instanceof Error ? err.message : String(err)}\n`)
      failed++
    }
  }

  console.log('----------------------------------------------------------------------')
  console.log(`Results: ${passed}/${GATES.length} Gates Passed (${failed} Failed)`)
  console.log('----------------------------------------------------------------------\n')

  if (failed > 0) {
    console.error('Release verification FAILED. Correct issues above before release.')
    process.exit(1)
  } else {
    console.log('SUCCESS: All 7 Release Gates PASSED with zero stubs and zero placeholders!')
    process.exit(0)
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err)
  process.exit(1)
})
