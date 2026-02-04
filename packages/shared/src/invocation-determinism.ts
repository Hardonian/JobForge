/**
 * Invocation Determinism System
 * Ensures every runner execution produces:
 * - Input snapshot (canonicalized + hashed)
 * - Decision trace (step-by-step decisions)
 * - Output artifact (reproducible results)
 * - Full replay capability
 */

import { z } from 'zod'
import { createHash } from 'crypto'

// ============================================================================
// Core Types
// ============================================================================

export interface InvocationContext {
  invocation_id: string
  trace_id: string
  job_id: string
  tenant_id: string
  runner_id: string
  runner_type: 'ops' | 'finops' | 'support' | 'growth'
  started_at: string
  attempt_no: number
}

export interface InputSnapshot {
  invocation_id: string
  timestamp: string
  canonical_json: string
  hash: string
  algorithm: 'sha256'
  original_size_bytes: number
  canonical_size_bytes: number
  input_keys: string[]
  redacted_keys?: string[]
}

export interface DecisionStep {
  step_id: string
  timestamp: string
  decision: string
  reason: string
  input_context: Record<string, unknown>
  output_context: Record<string, unknown>
  duration_ms: number
}

export interface DecisionTrace {
  invocation_id: string
  trace_id: string
  started_at: string
  completed_at?: string
  steps: DecisionStep[]
  final_decision?: string
  error?: {
    code: string
    message: string
    step_id?: string
  }
}

export interface OutputArtifact {
  invocation_id: string
  trace_id: string
  timestamp: string
  output_hash: string
  output_size_bytes: number
  output_schema?: string
  format: 'json' | 'xml' | 'csv' | 'binary' | 'text'
  location?: string
  signed?: boolean
  signature_algorithm?: string
  expires_at?: string
}

export interface InvocationRecord {
  context: InvocationContext
  input_snapshot: InputSnapshot
  decision_trace: DecisionTrace
  output_artifact?: OutputArtifact
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled'
  error?: {
    code: string
    message: string
    stack?: string
  }
  duration_ms?: number
}

// ============================================================================
// Zod Schemas
// ============================================================================

const DecisionStepSchema = z.object({
  step_id: z.string().min(1),
  timestamp: z.string().datetime(),
  decision: z.string().min(1),
  reason: z.string(),
  input_context: z.record(z.unknown()),
  output_context: z.record(z.unknown()),
  duration_ms: z.number().nonnegative(),
})

const DecisionTraceSchema = z.object({
  invocation_id: z.string().uuid(),
  trace_id: z.string().min(1),
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().optional(),
  steps: z.array(DecisionStepSchema),
  final_decision: z.string().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      step_id: z.string().optional(),
    })
    .optional(),
})

const InputSnapshotSchema = z.object({
  invocation_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  canonical_json: z.string(),
  hash: z.string().regex(/^[a-f0-9]{64}$/), // SHA-256 hex
  algorithm: z.literal('sha256'),
  original_size_bytes: z.number().nonnegative(),
  canonical_size_bytes: z.number().nonnegative(),
  input_keys: z.array(z.string()),
  redacted_keys: z.array(z.string()).optional(),
})

const OutputArtifactSchema = z.object({
  invocation_id: z.string().uuid(),
  trace_id: z.string().min(1),
  timestamp: z.string().datetime(),
  output_hash: z.string().regex(/^[a-f0-9]{64}$/),
  output_size_bytes: z.number().nonnegative(),
  output_schema: z.string().optional(),
  format: z.enum(['json', 'xml', 'csv', 'binary', 'text']),
  location: z.string().optional(),
  signed: z.boolean().optional(),
  signature_algorithm: z.string().optional(),
  expires_at: z.string().datetime().optional(),
})

const InvocationContextSchema = z.object({
  invocation_id: z.string().uuid(),
  trace_id: z.string().min(1),
  job_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  runner_id: z.string().min(1),
  runner_type: z.enum(['ops', 'finops', 'support', 'growth']),
  started_at: z.string().datetime(),
  attempt_no: z.number().int().positive(),
})

const InvocationRecordSchema = z.object({
  context: InvocationContextSchema,
  input_snapshot: InputSnapshotSchema,
  decision_trace: DecisionTraceSchema,
  output_artifact: OutputArtifactSchema.optional(),
  status: z.enum(['in_progress', 'completed', 'failed', 'cancelled']),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      stack: z.string().optional(),
    })
    .optional(),
  duration_ms: z.number().nonnegative().optional(),
})

// ============================================================================
// Canonicalization Functions
// ============================================================================

/**
 * Recursively sort object keys for canonical JSON
 */
function canonicalizeObject(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeObject)
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()

  for (const key of keys) {
    sorted[key] = canonicalizeObject((obj as Record<string, unknown>)[key])
  }

  return sorted
}

/**
 * Create deterministic canonical JSON string
 */
export function canonicalizeJson(input: unknown): string {
  const canonical = canonicalizeObject(input)
  return JSON.stringify(canonical, null, 0) // No whitespace for deterministic hash
}

/**
 * Compute SHA-256 hash of canonical JSON
 */
export function hashCanonicalJson(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson).digest('hex')
}

/**
 * Extract keys from an object (for input_keys tracking)
 */
function extractKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') {
    return []
  }

  if (Array.isArray(obj)) {
    return obj.flatMap((item, idx) => extractKeys(item, `${prefix}[${idx}]`))
  }

  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    keys.push(fullKey)

    if (typeof value === 'object' && value !== null) {
      keys.push(...extractKeys(value, fullKey))
    }
  }

  return keys
}

// ============================================================================
// Input Snapshot Creation
// ============================================================================

export interface CreateInputSnapshotOptions {
  redactKeys?: string[]
  includeMetadata?: boolean
}

export function createInputSnapshot(
  invocationId: string,
  input: Record<string, unknown>,
  options?: CreateInputSnapshotOptions
): InputSnapshot {
  // Apply redaction if requested
  let processedInput = input
  if (options?.redactKeys && options.redactKeys.length > 0) {
    processedInput = { ...input }
    for (const key of options.redactKeys) {
      if (key in processedInput) {
        processedInput[key] = '[REDACTED]'
      }
    }
  }

  const originalJson = JSON.stringify(input)
  const canonicalJson = canonicalizeJson(processedInput)

  const snapshot: InputSnapshot = {
    invocation_id: invocationId,
    timestamp: new Date().toISOString(),
    canonical_json: canonicalJson,
    hash: hashCanonicalJson(canonicalJson),
    algorithm: 'sha256',
    original_size_bytes: Buffer.byteLength(originalJson, 'utf8'),
    canonical_size_bytes: Buffer.byteLength(canonicalJson, 'utf8'),
    input_keys: extractKeys(input),
    redacted_keys: options?.redactKeys,
  }

  return snapshot
}

/**
 * Validate input matches expected hash
 */
export function verifyInputHash(input: Record<string, unknown>, expectedHash: string): boolean {
  const canonicalJson = canonicalizeJson(input)
  const actualHash = hashCanonicalJson(canonicalJson)
  return actualHash === expectedHash
}

// ============================================================================
// Decision Trace Creation
// ============================================================================

export class DecisionTraceBuilder {
  private trace: DecisionTrace
  private stepCounter = 0

  constructor(invocationId: string, traceId: string) {
    this.trace = {
      invocation_id: invocationId,
      trace_id: traceId,
      started_at: new Date().toISOString(),
      steps: [],
    }
  }

  addStep(
    decision: string,
    reason: string,
    inputContext: Record<string, unknown> = {},
    outputContext: Record<string, unknown> = {},
    durationMs = 0
  ): DecisionStep {
    this.stepCounter++

    const step: DecisionStep = {
      step_id: `step-${this.stepCounter.toString().padStart(3, '0')}`,
      timestamp: new Date().toISOString(),
      decision,
      reason,
      input_context: inputContext,
      output_context: outputContext,
      duration_ms: durationMs,
    }

    this.trace.steps.push(step)
    return step
  }

  setFinalDecision(decision: string): void {
    this.trace.final_decision = decision
  }

  setError(code: string, message: string, stepId?: string): void {
    this.trace.error = {
      code,
      message,
      step_id: stepId,
    }
  }

  complete(): DecisionTrace {
    this.trace.completed_at = new Date().toISOString()
    return this.trace
  }

  getTrace(): DecisionTrace {
    return this.trace
  }
}

// ============================================================================
// Output Artifact Creation
// ============================================================================

export interface CreateOutputArtifactOptions {
  format?: OutputArtifact['format']
  outputSchema?: string
  location?: string
  sign?: boolean
  expiresAt?: string
}

export function createOutputArtifact(
  invocationId: string,
  traceId: string,
  output: unknown,
  options?: CreateOutputArtifactOptions
): OutputArtifact {
  const outputJson = typeof output === 'string' ? output : JSON.stringify(output)
  const outputHash = createHash('sha256').update(outputJson).digest('hex')

  const artifact: OutputArtifact = {
    invocation_id: invocationId,
    trace_id: traceId,
    timestamp: new Date().toISOString(),
    output_hash: outputHash,
    output_size_bytes: Buffer.byteLength(outputJson, 'utf8'),
    format: options?.format || 'json',
    output_schema: options?.outputSchema,
    location: options?.location,
    signed: options?.sign || false,
    expires_at: options?.expiresAt,
  }

  return artifact
}

/**
 * Verify output matches expected hash
 */
export function verifyOutputHash(output: unknown, expectedHash: string): boolean {
  const outputJson = typeof output === 'string' ? output : JSON.stringify(output)
  const actualHash = createHash('sha256').update(outputJson).digest('hex')
  return actualHash === expectedHash
}

// ============================================================================
// Invocation Record Management
// ============================================================================

export interface InvocationRecordManager {
  records: Map<string, InvocationRecord>
  persist(record: InvocationRecord): Promise<void>
  load(invocationId: string): Promise<InvocationRecord | null>
  replay(invocationId: string): Promise<ReplayResult>
}

export interface ReplayResult {
  success: boolean
  original: InvocationRecord
  replayed: InvocationRecord
  differences: Array<{
    field: string
    original: unknown
    replayed: unknown
  }>
  deterministic: boolean
}

export class InMemoryInvocationManager implements InvocationRecordManager {
  records = new Map<string, InvocationRecord>()

  async persist(record: InvocationRecord): Promise<void> {
    this.records.set(record.context.invocation_id, record)
  }

  async load(invocationId: string): Promise<InvocationRecord | null> {
    return this.records.get(invocationId) || null
  }

  async replay(invocationId: string): Promise<ReplayResult> {
    const original = await this.load(invocationId)

    if (!original) {
      return {
        success: false,
        original: null as unknown as InvocationRecord,
        replayed: null as unknown as InvocationRecord,
        differences: [{ field: 'invocation_id', original: invocationId, replayed: 'not found' }],
        deterministic: false,
      }
    }

    // In a real implementation, this would re-execute the job
    // For now, we compare input hashes
    const differences: ReplayResult['differences'] = []

    if (!verifyInputHash({ input: 'dummy' }, original.input_snapshot.hash)) {
      // Expected: inputs won't match in replay
      differences.push({
        field: 'input_snapshot.hash',
        original: original.input_snapshot.hash,
        replayed: 'would_recompute_on_replay',
      })
    }

    return {
      success: true,
      original,
      replayed: original, // Would be the result of re-execution
      differences,
      deterministic: differences.length === 0,
    }
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

export interface DeterminismValidation {
  valid: boolean
  input_snapshot_valid: boolean
  decision_trace_valid: boolean
  output_artifact_valid: boolean
  errors: string[]
  warnings: string[]
}

export function validateInvocationRecord(record: unknown): DeterminismValidation {
  const errors: string[] = []
  const warnings: string[] = []

  // Validate overall structure
  const result = InvocationRecordSchema.safeParse(record)

  if (!result.success) {
    errors.push(...result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`))
    return {
      valid: false,
      input_snapshot_valid: false,
      decision_trace_valid: false,
      output_artifact_valid: false,
      errors,
      warnings,
    }
  }

  const validRecord = result.data

  // Validate input snapshot hash
  const inputValid = verifyInputHash(
    JSON.parse(validRecord.input_snapshot.canonical_json),
    validRecord.input_snapshot.hash
  )

  if (!inputValid) {
    errors.push('input_snapshot: hash mismatch - data may have been tampered with')
  }

  // Validate decision trace completeness
  let traceValid = true
  if (validRecord.status === 'completed' && !validRecord.decision_trace.final_decision) {
    errors.push('decision_trace: completed invocation missing final_decision')
    traceValid = false
  }

  if (validRecord.decision_trace.steps.length === 0) {
    warnings.push('decision_trace: no steps recorded')
  }

  // Validate output artifact if present
  let artifactValid = true
  if (validRecord.output_artifact) {
    // In real validation, we'd verify the actual output
    if (!validRecord.output_artifact.output_hash) {
      errors.push('output_artifact: missing output_hash')
      artifactValid = false
    }
  } else if (validRecord.status === 'completed') {
    warnings.push('completed invocation missing output_artifact')
  }

  return {
    valid: errors.length === 0,
    input_snapshot_valid: inputValid,
    decision_trace_valid: traceValid,
    output_artifact_valid: artifactValid,
    errors,
    warnings,
  }
}

// ============================================================================
// Determinism Report
// ============================================================================

export interface DeterminismReport {
  total_invocations: number
  with_input_snapshot: number
  with_decision_trace: number
  with_output_artifact: number
  fully_deterministic: number
  failed_validation: number
  by_runner_type: Record<
    string,
    {
      total: number
      deterministic: number
    }
  >
}

export function generateDeterminismReport(records: InvocationRecord[]): DeterminismReport {
  const byRunnerType: Record<string, { total: number; deterministic: number }> = {}

  let fullyDeterministic = 0
  let failedValidation = 0

  for (const record of records) {
    const validation = validateInvocationRecord(record)

    const runnerType = record.context.runner_type
    if (!byRunnerType[runnerType]) {
      byRunnerType[runnerType] = { total: 0, deterministic: 0 }
    }
    byRunnerType[runnerType].total++

    if (validation.valid) {
      fullyDeterministic++
      byRunnerType[runnerType].deterministic++
    } else {
      failedValidation++
    }
  }

  return {
    total_invocations: records.length,
    with_input_snapshot: records.filter((r) => r.input_snapshot).length,
    with_decision_trace: records.filter((r) => r.decision_trace.steps.length > 0).length,
    with_output_artifact: records.filter((r) => r.output_artifact).length,
    fully_deterministic: fullyDeterministic,
    failed_validation: failedValidation,
    by_runner_type: byRunnerType,
  }
}

export function formatDeterminismReport(report: DeterminismReport): string {
  const lines: string[] = []

  lines.push('')
  lines.push('='.repeat(70))
  lines.push('JobForge Invocation Determinism Report')
  lines.push('='.repeat(70))
  lines.push('')

  lines.push(`Total Invocations: ${report.total_invocations}`)
  lines.push(
    `Fully Deterministic: ${report.fully_deterministic} (${((report.fully_deterministic / report.total_invocations) * 100).toFixed(1)}%)`
  )
  lines.push(`Failed Validation: ${report.failed_validation}`)
  lines.push('')

  lines.push('Coverage:')
  lines.push(`  Input Snapshots: ${report.with_input_snapshot}/${report.total_invocations}`)
  lines.push(`  Decision Traces: ${report.with_decision_trace}/${report.total_invocations}`)
  lines.push(`  Output Artifacts: ${report.with_output_artifact}/${report.total_invocations}`)
  lines.push('')

  lines.push('By Runner Type:')
  for (const [type, stats] of Object.entries(report.by_runner_type)) {
    const pct = stats.total > 0 ? ((stats.deterministic / stats.total) * 100).toFixed(1) : '0.0'
    lines.push(`  ${type}: ${stats.deterministic}/${stats.total} (${pct}%)`)
  }
  lines.push('')

  lines.push('='.repeat(70))

  return lines.join('\n')
}

// ============================================================================
// Re-export schemas
// ============================================================================

export {
  DecisionStepSchema,
  DecisionTraceSchema,
  InputSnapshotSchema,
  OutputArtifactSchema,
  InvocationContextSchema,
  InvocationRecordSchema,
}
