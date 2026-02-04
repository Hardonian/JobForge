/**
 * Invocation Determinism Module
 *
 * Provides comprehensive invocation-level tracing, I/O capture, and determinism verification.
 * Builds on existing trace_id system and integrates with runner contract enforcement.
 *
 * Feature Flags:
 *   - INVOCATION_DETERMINISM_ENABLED=1 (default OFF)
 *   - STRICT_DETERMINISM_MODE=1 (default OFF - enforces all 4 guarantees)
 *
 * @module invocation-determinism
 */

import { randomUUID, createHash } from 'crypto'
import { TraceContext, generateTraceId } from '../integration/src/trace.js'
import { ObservabilityLogger } from '../observability/src/logger.js'
import { ObservabilitySpan } from '../observability/src/span.js'
import { RunnerConfig } from './runner-contract-enforcement.js'
import {
  canonicalizeObject,
  createInputSnapshot as createReplayInputSnapshot,
  getCodeFingerprint,
  getRuntimeFingerprint,
  getDependencyFingerprint,
  getEnvironmentFingerprint,
  InputSnapshot as ReplayInputSnapshot,
} from './replay.js'

// ============================================================================
// Feature Flags (Dynamic - checked at runtime)
// ============================================================================

function getEnvVar(name: string, defaultValue: string): string {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] ?? defaultValue
  }
  return defaultValue
}

function parseBool(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true'
}

/**
 * Check if invocation determinism is enabled
 */
export function isInvocationDeterminismEnabled(): boolean {
  return parseBool(getEnvVar('INVOCATION_DETERMINISM_ENABLED', '0'))
}

/**
 * Check if strict determinism mode is enabled (enforces all 4 guarantees)
 */
export function isStrictDeterminismMode(): boolean {
  return parseBool(getEnvVar('STRICT_DETERMINISM_MODE', '0'))
}

// ============================================================================
// Core Types
// ============================================================================

/**
 * I/O capture configuration
 */
export interface IOCaptureConfig {
  captureStdout: boolean
  captureStderr: boolean
  captureStdin: boolean
  maxSizeBytes: number
  maxLines: number
  timeoutMs: number
}

/**
 * Captured I/O streams
 */
export interface CapturedIO {
  stdout: string | null
  stderr: string | null
  stdin: string | null
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdinTruncated: boolean
  capturedAt: string
  captureDurationMs: number
}

/**
 * Decision trace entry
 */
export interface DecisionTrace {
  /** Unique decision identifier */
  decisionId: string
  /** Timestamp of decision */
  timestamp: string
  /** Decision type */
  type: 'allow' | 'deny' | 'conditional' | 'error' | 'unknown'
  /** Decision reason */
  reason: string
  /** Decision context */
  context: Record<string, unknown>
  /** Input hash at decision time */
  inputHash: string
  /** Runtime state at decision time */
  runtimeState: Record<string, unknown>
  /** Decision duration in ms */
  durationMs: number
  /** Whether this decision was deterministic */
  deterministic: boolean
}

/**
 * Invocation snapshot - captures complete state at invocation time
 */
export interface InvocationSnapshot {
  /** Unique snapshot identifier */
  snapshotId: string
  /** Trace ID for correlation */
  traceId: string
  /** Parent trace ID if nested */
  parentTraceId?: string
  /** Invocation sequence number */
  sequenceNumber: number
  /** Invocation timestamp */
  timestamp: string
  /** Function/operation being invoked */
  operationName: string
  /** Input snapshot */
  inputs: ReplayInputSnapshot
  /** Captured I/O if enabled */
  capturedIO?: CapturedIO
  /** Runtime fingerprints */
  fingerprints: {
    code: Awaited<ReturnType<typeof getCodeFingerprint>>
    runtime: ReturnType<typeof getRuntimeFingerprint>
    dependencies: Awaited<ReturnType<typeof getDependencyFingerprint>>
    environment: ReturnType<typeof getEnvironmentFingerprint>
  }
  /** Decision traces if any */
  decisionTraces: DecisionTrace[]
  /** Environment state (safe variables only) */
  environmentState: Record<string, string>
  /** Feature flags at time of invocation */
  featureFlags: Record<string, boolean>
}

/**
 * Determinism guarantees check result
 */
export interface DeterminismCheck {
  /** Which guarantee was checked */
  guarantee: 'input_snapshot' | 'decision_trace' | 'output_artifact' | 'replayable'
  /** Whether the guarantee is satisfied */
  satisfied: boolean
  /** Violations if not satisfied */
  violations: string[]
  /** Score (0-1) for partial satisfaction */
  score: number
}

/**
 * Invocation determinism report
 */
export interface InvocationDeterminismReport {
  /** Report ID */
  reportId: string
  /** Invocation snapshot reference */
  snapshotId: string
  /** Overall determinism score (0-1) */
  determinismScore: number
  /** All determinism checks */
  checks: DeterminismCheck[]
  /** Whether invocation passed all strict checks */
  passed: boolean
  /** Recommendations for improvement */
  recommendations: string[]
  /** Verification timestamp */
  verifiedAt: string
}

/**
 * Determinism violation
 */
export interface DeterminismViolation {
  /** Violation type */
  type:
    | 'input_mutation'
    | 'decision_inconsistency'
    | 'io_non_determinism'
    | 'environment_drift'
    | 'missing_trace'
  /** Description of the violation */
  description: string
  /** Severity */
  severity: 'warning' | 'error' | 'critical'
  /** Affected trace ID */
  traceId: string
  /** Timestamp of detection */
  detectedAt: string
  /** Context at detection time */
  context: Record<string, unknown>
}

// ============================================================================
// I/O Capture System
// ============================================================================

/**
 * Default I/O capture configuration
 */
export const DEFAULT_IO_CAPTURE_CONFIG: IOCaptureConfig = {
  captureStdout: true,
  captureStderr: true,
  captureStdin: false, // Usually don't capture stdin for replay safety
  maxSizeBytes: 1024 * 1024, // 1MB per stream
  maxLines: 10000,
  timeoutMs: 300000, // 5 minutes
}

/**
 * Capture I/O for a function execution
 *
 * @example
 * ```typescript
 * const capture = await captureInvocationIO(
 *   async () => await processData(input),
 *   { captureStdout: true, captureStderr: true }
 * )
 * // capture.result contains the function result
 * // capture.io contains captured streams
 * ```
 */
export async function captureInvocationIO<T>(
  fn: () => Promise<T>,
  config: Partial<IOCaptureConfig> = {},
  existingStreams?: { stdout?: NodeJS.WriteStream; stderr?: NodeJS.WriteStream }
): Promise<{ result: T; io: CapturedIO; error?: Error }> {
  const startTime = Date.now()
  const mergedConfig = { ...DEFAULT_IO_CAPTURE_CONFIG, ...config }

  // In browser/non-Node environments, skip capture
  if (typeof process === 'undefined' || !process.stdout) {
    const result = await fn()
    return {
      result,
      io: {
        stdout: null,
        stderr: null,
        stdin: null,
        stdoutTruncated: false,
        stderrTruncated: false,
        stdinTruncated: false,
        capturedAt: new Date().toISOString(),
        captureDurationMs: Date.now() - startTime,
      },
    }
  }

  // Store original streams
  const originalStdout = existingStreams?.stdout || process.stdout
  const originalStderr = existingStreams?.stderr || process.stderr

  // Create buffers
  const stdoutBuffer: string[] = []
  const stderrBuffer: string[] = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let stdoutTruncated = false
  let stderrTruncated = false

  // Create mock streams
  const mockStdout = {
    write: (chunk: string | Buffer) => {
      if (!mergedConfig.captureStdout || stdoutTruncated) return true

      const str = chunk.toString()
      const bytes = Buffer.byteLength(str, 'utf8')

      if (stdoutBytes + bytes > mergedConfig.maxSizeBytes) {
        stdoutTruncated = true
        return true
      }

      stdoutBuffer.push(str)
      stdoutBytes += bytes

      // Also write to original
      return originalStdout.write(chunk)
    },
  }

  const mockStderr = {
    write: (chunk: string | Buffer) => {
      if (!mergedConfig.captureStderr || stderrTruncated) return true

      const str = chunk.toString()
      const bytes = Buffer.byteLength(str, 'utf8')

      if (stderrBytes + bytes > mergedConfig.maxSizeBytes) {
        stderrTruncated = true
        return true
      }

      stderrBuffer.push(str)
      stderrBytes += bytes

      // Also write to original
      return originalStderr.write(chunk)
    },
  }

  try {
    // Replace streams temporarily (only works in Node.js)
    if (!existingStreams) {
      Object.defineProperty(process, 'stdout', { value: mockStdout, writable: true })
      Object.defineProperty(process, 'stderr', { value: mockStderr, writable: true })
    }

    // Execute function
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('I/O capture timeout')), mergedConfig.timeoutMs)
      ),
    ])

    return {
      result,
      io: {
        stdout: mergedConfig.captureStdout ? stdoutBuffer.join('') : null,
        stderr: mergedConfig.captureStderr ? stderrBuffer.join('') : null,
        stdin: null, // Not captured by default
        stdoutTruncated,
        stderrTruncated,
        stdinTruncated: false,
        capturedAt: new Date().toISOString(),
        captureDurationMs: Date.now() - startTime,
      },
    }
  } catch (error) {
    return {
      result: undefined as T,
      io: {
        stdout: mergedConfig.captureStdout ? stdoutBuffer.join('') : null,
        stderr: mergedConfig.captureStderr ? stderrBuffer.join('') : null,
        stdin: null,
        stdoutTruncated,
        stderrTruncated,
        stdinTruncated: false,
        capturedAt: new Date().toISOString(),
        captureDurationMs: Date.now() - startTime,
      },
      error: error instanceof Error ? error : new Error(String(error)),
    }
  } finally {
    // Restore streams
    if (!existingStreams) {
      Object.defineProperty(process, 'stdout', { value: originalStdout, writable: true })
      Object.defineProperty(process, 'stderr', { value: originalStderr, writable: true })
    }
  }
}

// ============================================================================
// Decision Trace System
// ============================================================================

/**
 * Decision trace logger - records decisions during invocation
 */
export class DecisionTraceLogger {
  private traces: DecisionTrace[] = []
  private traceId: string
  private inputHash: string
  private startTime: number

  constructor(traceId: string, inputHash: string) {
    this.traceId = traceId
    this.inputHash = inputHash
    this.startTime = Date.now()
  }

  /**
   * Log a decision
   */
  logDecision(
    type: DecisionTrace['type'],
    reason: string,
    context: Record<string, unknown> = {},
    runtimeState: Record<string, unknown> = {}
  ): DecisionTrace {
    const trace: DecisionTrace = {
      decisionId: `decision-${randomUUID()}`,
      timestamp: new Date().toISOString(),
      type,
      reason,
      context: { ...context, traceId: this.traceId },
      runtimeState: { ...runtimeState, elapsedMs: Date.now() - this.startTime },
      inputHash: this.inputHash,
      durationMs: Date.now() - this.startTime,
      deterministic: this.isDeterministicDecision(type, context),
    }

    this.traces.push(trace)
    return trace
  }

  /**
   * Log an allow decision
   */
  allow(reason: string, context?: Record<string, unknown>): DecisionTrace {
    return this.logDecision('allow', reason, context)
  }

  /**
   * Log a deny decision
   */
  deny(reason: string, context?: Record<string, unknown>): DecisionTrace {
    return this.logDecision('deny', reason, context)
  }

  /**
   * Log a conditional decision
   */
  conditional(reason: string, context?: Record<string, unknown>): DecisionTrace {
    return this.logDecision('conditional', reason, context)
  }

  /**
   * Log an error decision
   */
  error(reason: string, context?: Record<string, unknown>): DecisionTrace {
    return this.logDecision('error', reason, context)
  }

  /**
   * Get all recorded traces
   */
  getTraces(): DecisionTrace[] {
    return [...this.traces]
  }

  /**
   * Check if a decision type is inherently deterministic
   */
  private isDeterministicDecision(
    type: DecisionTrace['type'],
    context: Record<string, unknown>
  ): boolean {
    // Error decisions are deterministic (always error)
    if (type === 'error') return true

    // Deny decisions based on policy are deterministic
    if (type === 'deny' && context['policy_based']) return true

    // Conditional decisions may be non-deterministic
    if (type === 'conditional') {
      return context['deterministic_rules'] === true
    }

    // Allow decisions may depend on state
    return false
  }
}

// ============================================================================
// Invocation Snapshot System
// ============================================================================

/**
 * Create a complete invocation snapshot
 */
export async function createInvocationSnapshot(
  operationName: string,
  inputs: Record<string, unknown>,
  options: {
    traceId?: string
    parentTraceId?: string
    sequenceNumber?: number
    captureIO?: boolean
    ioConfig?: Partial<IOCaptureConfig>
    decisionLogger?: DecisionTraceLogger
    traceContext?: TraceContext
  } = {}
): Promise<InvocationSnapshot> {
  const snapshotId = `snapshot-${randomUUID()}`
  const traceId = options.traceId || generateTraceId()
  const inputSnapshot = createReplayInputSnapshot(inputs)

  // Capture fingerprints
  const [code, runtime, dependencies, environment] = await Promise.all([
    getCodeFingerprint(),
    getRuntimeFingerprint(),
    getDependencyFingerprint(),
    getEnvironmentFingerprint(),
  ])

  // Get safe environment state
  const environmentState = getSafeEnvironmentState()

  // Get feature flags
  const featureFlags = getFeatureFlagsSnapshot()

  return {
    snapshotId,
    traceId,
    parentTraceId: options.parentTraceId,
    sequenceNumber: options.sequenceNumber || 0,
    timestamp: new Date().toISOString(),
    operationName,
    inputs: inputSnapshot,
    fingerprints: {
      code,
      runtime,
      dependencies,
      environment,
    },
    decisionTraces: options.decisionLogger?.getTraces() || [],
    environmentState,
    featureFlags,
  }
}

/**
 * Get safe environment state (no secrets)
 */
function getSafeEnvironmentState(): Record<string, string> {
  const safe: Record<string, string> = {}
  const safePatterns = [/^NODE_ENV$/, /^JOBFORGE_/, /^REPLAY_/, /^VERIFY_/, /^INVOCATION_/]

  if (typeof process !== 'undefined' && process.env) {
    for (const [key, value] of Object.entries(process.env)) {
      if (value && safePatterns.some((p) => p.test(key))) {
        // Exclude any that might contain secret-like patterns
        if (!/(SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|PRIVATE)/i.test(key)) {
          safe[key] = value
        }
      }
    }
  }

  return safe
}

/**
 * Get feature flags snapshot
 */
function getFeatureFlagsSnapshot(): Record<string, boolean> {
  return {
    invocation_determinism_enabled: isInvocationDeterminismEnabled(),
    strict_determinism_mode: isStrictDeterminismMode(),
    replay_pack_enabled: parseBool(getEnvVar('REPLAY_PACK_ENABLED', '0')),
    obs_enabled: parseBool(getEnvVar('OBS_ENABLED', '0')),
    manifests_enabled: parseBool(getEnvVar('JOBFORGE_MANIFESTS_ENABLED', '0')),
  }
}

// ============================================================================
// Determinism Verification Engine
// ============================================================================

/**
 * Verify determinism guarantees for an invocation
 */
export async function verifyInvocationDeterminism(
  snapshot: InvocationSnapshot,
  runnerConfig?: RunnerConfig
): Promise<InvocationDeterminismReport> {
  const startTime = Date.now()
  const checks: DeterminismCheck[] = []
  const recommendations: string[] = []

  // Check 1: Input Snapshot Guarantee
  const inputCheck = verifyInputSnapshotGuarantee(snapshot)
  checks.push(inputCheck)
  if (!inputCheck.satisfied) {
    recommendations.push('Enable input canonicalization and hashing for all invocations')
  }

  // Check 2: Decision Trace Guarantee
  const decisionCheck = verifyDecisionTraceGuarantee(snapshot)
  checks.push(decisionCheck)
  if (!decisionCheck.satisfied) {
    recommendations.push('Use DecisionTraceLogger for all policy decisions')
  }

  // Check 3: Output Artifact Guarantee
  const outputCheck = verifyOutputArtifactGuarantee(snapshot)
  checks.push(outputCheck)
  if (!outputCheck.satisfied) {
    recommendations.push('Ensure all outputs are captured in artifacts with refs')
  }

  // Check 4: Replayable Guarantee
  const replayableCheck = verifyReplayableGuarantee(snapshot, runnerConfig)
  checks.push(replayableCheck)
  if (!replayableCheck.satisfied) {
    recommendations.push('Verify environment stability and code version pinning')
  }

  // Calculate overall score
  const determinismScore = checks.reduce((sum, c) => sum + c.score, 0) / checks.length

  // Strict mode: all must pass
  const passed = isStrictDeterminismMode()
    ? checks.every((c) => c.satisfied)
    : determinismScore >= 0.75

  return {
    reportId: `report-${randomUUID()}`,
    snapshotId: snapshot.snapshotId,
    determinismScore,
    checks,
    passed,
    recommendations,
    verifiedAt: new Date().toISOString(),
  }
}

/**
 * Verify input snapshot guarantee
 */
function verifyInputSnapshotGuarantee(snapshot: InvocationSnapshot): DeterminismCheck {
  const violations: string[] = []

  if (!snapshot.inputs.canonicalJson) {
    violations.push('Missing canonical JSON representation')
  }

  if (!snapshot.inputs.hash) {
    violations.push('Missing input hash')
  }

  if (snapshot.inputs.originalKeys.length === 0) {
    violations.push('No input keys recorded')
  }

  // Verify hash is valid SHA-256
  if (snapshot.inputs.hash && !/^[a-f0-9]{64}$/.test(snapshot.inputs.hash)) {
    violations.push('Invalid hash format (expected SHA-256 hex)')
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length * 0.25)

  return {
    guarantee: 'input_snapshot',
    satisfied: violations.length === 0,
    violations,
    score,
  }
}

/**
 * Verify decision trace guarantee
 */
function verifyDecisionTraceGuarantee(snapshot: InvocationSnapshot): DeterminismCheck {
  const violations: string[] = []

  if (snapshot.decisionTraces.length === 0) {
    violations.push('No decision traces recorded')
  } else {
    // Check for non-deterministic decisions
    const nonDeterministicTraces = snapshot.decisionTraces.filter((t) => !t.deterministic)
    if (nonDeterministicTraces.length > 0) {
      violations.push(`${nonDeterministicTraces.length} non-deterministic decisions detected`)
    }

    // Check for missing timestamps
    const missingTimestamps = snapshot.decisionTraces.filter((t) => !t.timestamp)
    if (missingTimestamps.length > 0) {
      violations.push(`${missingTimestamps.length} decisions missing timestamps`)
    }

    // Check for missing decision IDs
    const missingIds = snapshot.decisionTraces.filter((t) => !t.decisionId)
    if (missingIds.length > 0) {
      violations.push(`${missingIds.length} decisions missing IDs`)
    }
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length * 0.2)

  return {
    guarantee: 'decision_trace',
    satisfied: violations.length === 0,
    violations,
    score,
  }
}

/**
 * Verify output artifact guarantee
 */
function verifyOutputArtifactGuarantee(snapshot: InvocationSnapshot): DeterminismCheck {
  const violations: string[] = []

  // For now, check if we have I/O capture as a proxy for artifact capture
  if (!snapshot.capturedIO) {
    violations.push('No I/O capture recorded')
  } else {
    if (snapshot.capturedIO.stdout === null && snapshot.capturedIO.stderr === null) {
      violations.push('No output streams captured')
    }

    if (snapshot.capturedIO.stdoutTruncated || snapshot.capturedIO.stderrTruncated) {
      violations.push('Output streams were truncated')
    }
  }

  // Check for environment state capture
  if (Object.keys(snapshot.environmentState).length === 0) {
    violations.push('No environment state captured')
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length * 0.25)

  return {
    guarantee: 'output_artifact',
    satisfied: violations.length === 0,
    violations,
    score,
  }
}

/**
 * Verify replayable guarantee
 */
function verifyReplayableGuarantee(
  snapshot: InvocationSnapshot,
  runnerConfig?: RunnerConfig
): DeterminismCheck {
  const violations: string[] = []

  // Check code fingerprint
  if (!snapshot.fingerprints.code.gitSha) {
    violations.push('No Git SHA captured (required for replay)')
  }

  if (snapshot.fingerprints.code.gitDirty) {
    violations.push('Code was dirty at capture time')
  }

  // Check dependency fingerprint
  if (!snapshot.fingerprints.dependencies.lockfileHash) {
    violations.push('No lockfile hash captured')
  }

  // Check environment stability
  if (!snapshot.fingerprints.environment.timestamp) {
    violations.push('No environment timestamp captured')
  }

  // If runner config provided, verify it supports replay
  if (runnerConfig) {
    if (!runnerConfig.determinism.replayable) {
      violations.push('Runner does not declare replayable support')
    }

    if (!runnerConfig.methods.trace) {
      violations.push('Runner does not support trace method')
    }
  }

  const score = violations.length === 0 ? 1.0 : Math.max(0, 1.0 - violations.length * 0.2)

  return {
    guarantee: 'replayable',
    satisfied: violations.length === 0,
    violations,
    score,
  }
}

// ============================================================================
// Runtime Enforcement
// ============================================================================

/**
 * Determinism enforcement options
 */
export interface DeterminismEnforcementOptions {
  /** Require all 4 guarantees */
  strictMode?: boolean
  /** Fail on violation */
  failFast?: boolean
  /** Log violations */
  logViolations?: boolean
  /** Callback on violation */
  onViolation?: (violation: DeterminismViolation) => void
}

/**
 * Determinism enforcer - runtime verification
 */
export class DeterminismEnforcer {
  private options: Required<DeterminismEnforcementOptions>
  private logger: ObservabilityLogger
  private violations: DeterminismViolation[] = []

  constructor(serviceName: string, options: DeterminismEnforcementOptions = {}) {
    this.options = {
      strictMode: options.strictMode ?? isStrictDeterminismMode(),
      failFast: options.failFast ?? false,
      logViolations: options.logViolations ?? true,
      onViolation: options.onViolation ?? (() => {}),
    }

    this.logger = new ObservabilityLogger({
      service: serviceName,
      defaultContext: { component: 'determinism-enforcer' },
    })
  }

  /**
   * Enforce determinism for an invocation
   */
  async enforce<T>(
    operationName: string,
    inputs: Record<string, unknown>,
    fn: (snapshot: InvocationSnapshot) => Promise<T>,
    runnerConfig?: RunnerConfig
  ): Promise<{ result: T; snapshot: InvocationSnapshot; report: InvocationDeterminismReport }> {
    if (!isInvocationDeterminismEnabled()) {
      // Determinism disabled, just run the function
      const result = await fn({} as InvocationSnapshot)
      return {
        result,
        snapshot: {} as InvocationSnapshot,
        report: {} as InvocationDeterminismReport,
      }
    }

    // Create decision logger
    const decisionLogger = new DecisionTraceLogger(generateTraceId(), '')

    // Create snapshot
    const snapshot = await createInvocationSnapshot(operationName, inputs, {
      decisionLogger,
    })

    // Execute with monitoring
    let result: T
    try {
      result = await fn(snapshot)
    } catch (error) {
      // Log error as decision
      decisionLogger.error(error instanceof Error ? error.message : String(error), {
        error_type: error instanceof Error ? error.constructor.name : 'Unknown',
      })
      throw error
    }

    // Update snapshot with final decision traces
    snapshot.decisionTraces = decisionLogger.getTraces()

    // Verify determinism
    const report = await verifyInvocationDeterminism(snapshot, runnerConfig)

    // Handle violations
    if (!report.passed) {
      for (const check of report.checks.filter((c) => !c.satisfied)) {
        const violation: DeterminismViolation = {
          type: this.mapGuaranteeToViolationType(check.guarantee),
          description: check.violations.join(', '),
          severity: this.options.strictMode ? 'error' : 'warning',
          traceId: snapshot.traceId,
          detectedAt: new Date().toISOString(),
          context: { operationName, determinismScore: report.determinismScore },
        }

        this.violations.push(violation)

        if (this.options.logViolations) {
          this.logger.warn('Determinism violation detected', {
            violation_type: violation.type,
            description: violation.description,
            severity: violation.severity,
            trace_id: snapshot.traceId,
          })
        }

        this.options.onViolation(violation)

        if (this.options.failFast) {
          throw new Error(`Determinism violation: ${violation.description}`)
        }
      }
    }

    return { result, snapshot, report }
  }

  /**
   * Get all recorded violations
   */
  getViolations(): DeterminismViolation[] {
    return [...this.violations]
  }

  /**
   * Clear violations
   */
  clearViolations(): void {
    this.violations = []
  }

  /**
   * Map guarantee type to violation type
   */
  private mapGuaranteeToViolationType(
    guarantee: DeterminismCheck['guarantee']
  ): DeterminismViolation['type'] {
    switch (guarantee) {
      case 'input_snapshot':
        return 'input_mutation'
      case 'decision_trace':
        return 'missing_trace'
      case 'output_artifact':
        return 'io_non_determinism'
      case 'replayable':
        return 'environment_drift'
    }
  }
}

// ============================================================================
// Integration with Observability
// ============================================================================

/**
 * Create an observability span with determinism tracking
 */
export async function withDeterminismSpan<T>(
  options: {
    traceId: string
    spanName: string
    service: string
    tenantId?: string
    operationName: string
    inputs: Record<string, unknown>
    runnerConfig?: RunnerConfig
    enforce?: boolean
  },
  fn: (span: ObservabilitySpan, snapshot: InvocationSnapshot) => Promise<T>
): Promise<{
  result: T
  span: ObservabilitySpan
  snapshot: InvocationSnapshot
  report: InvocationDeterminismReport
}> {
  const span = new ObservabilitySpan({
    traceId: options.traceId,
    spanName: options.spanName,
    service: options.service,
    tenantId: options.tenantId,
    additionalContext: { operation_name: options.operationName },
  })

  const decisionLogger = new DecisionTraceLogger(options.traceId, '')

  const snapshot = await createInvocationSnapshot(options.operationName, options.inputs, {
    traceId: options.traceId,
    decisionLogger,
  })

  try {
    const result = await fn(span, snapshot)

    // Update snapshot with final traces
    snapshot.decisionTraces = decisionLogger.getTraces()

    // Verify determinism
    const report = await verifyInvocationDeterminism(snapshot, options.runnerConfig)

    span.end('ok')

    // Log determinism metrics
    span.getLogger().info('Invocation completed with determinism check', {
      determinism_score: report.determinismScore,
      determinism_passed: report.passed,
      operation_name: options.operationName,
      trace_id: options.traceId,
    })

    return { result, span, snapshot, report }
  } catch (error) {
    decisionLogger.error(error instanceof Error ? error.message : String(error), {
      error_type: error instanceof Error ? error.constructor.name : 'Unknown',
    })

    span.end('error', error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

// ============================================================================
// Export Public API
// ============================================================================

export {
  DecisionTraceLogger,
  DeterminismEnforcer,
  createInvocationSnapshot,
  verifyInvocationDeterminism,
  captureInvocationIO,
  withDeterminismSpan,
  isInvocationDeterminismEnabled,
  isStrictDeterminismMode,
}

export type {
  IOCaptureConfig,
  CapturedIO,
  DecisionTrace,
  InvocationSnapshot,
  DeterminismCheck,
  InvocationDeterminismReport,
  DeterminismViolation,
  DeterminismEnforcementOptions,
}
