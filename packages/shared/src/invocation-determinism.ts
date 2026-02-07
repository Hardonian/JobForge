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
import type { RunnerConfig } from './runner-contract-enforcement.js'

// Inlined from @jobforge/integration to avoid circular dependency
// (integration depends on shared, so shared cannot depend on integration)
interface TraceContext {
  trace_id: string
  tenant_id: string
  project_id?: string
  actor_id?: string
  source_app: string
  started_at: string
}

function generateTraceId(): string {
  return randomUUID()
}

// Lightweight stubs for observability types to avoid circular dependency
// (observability depends on shared, so shared cannot depend on observability)
interface LogContext {
  [key: string]: unknown
}

class ObservabilityLogger {
  constructor(_config: { service: string; defaultContext?: LogContext }) {}
  info(message: string, _context?: LogContext): void {
    if (typeof console !== 'undefined') console.log(`[INFO] ${message}`)
  }
  warn(message: string, _context?: LogContext): void {
    if (typeof console !== 'undefined') console.warn(`[WARN] ${message}`)
  }
  error(message: string, _context?: LogContext): void {
    if (typeof console !== 'undefined') console.error(`[ERROR] ${message}`)
  }
  logError(message: string, _error: Error, _context?: LogContext): void {
    if (typeof console !== 'undefined') console.error(`[ERROR] ${message}`)
  }
}

class ObservabilitySpan {
  private _logger: ObservabilityLogger
  constructor(options: {
    traceId: string
    spanName: string
    service: string
    tenantId?: string
    additionalContext?: LogContext
  }) {
    this._logger = new ObservabilityLogger({ service: options.service })
  }
  end(_status: 'ok' | 'error' = 'ok', _error?: Error): void {}
  getLogger(): ObservabilityLogger {
    return this._logger
  }
  async execute<T>(fn: (span: ObservabilitySpan) => Promise<T>): Promise<T> {
    try {
      const result = await fn(this)
      this.end('ok')
      return result
    } catch (error) {
      this.end('error', error instanceof Error ? error : new Error(String(error)))
      throw error
    }
  }
}
import {
  createInputSnapshot as createReplayInputSnapshot,
  getCodeFingerprint,
  getRuntimeFingerprint,
  getDependencyFingerprint,
  getEnvironmentFingerprint,
  type InputSnapshot as ReplayInputSnapshot,
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
// Backward Compatibility Exports (Legacy API from original file)
// ============================================================================

// Legacy types for backward compatibility
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

export interface InputSnapshotLegacy {
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

export interface DecisionTraceLegacy {
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
  input_snapshot: InputSnapshotLegacy
  decision_trace: DecisionTraceLegacy
  output_artifact?: OutputArtifact
  status: 'in_progress' | 'completed' | 'failed' | 'cancelled'
  error?: {
    code: string
    message: string
    stack?: string
  }
  duration_ms?: number
}

export interface DeterminismValidation {
  valid: boolean
  input_snapshot_valid: boolean
  decision_trace_valid: boolean
  output_artifact_valid: boolean
  errors: string[]
  warnings: string[]
}

export interface DeterminismReport {
  total_invocations: number
  with_input_snapshot: number
  with_decision_trace: number
  with_output_artifact: number
  fully_deterministic: number
  failed_validation: number
  by_runner_type: Record<string, { total: number; deterministic: number }>
}

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
  differences: Array<{ field: string; original: unknown; replayed: unknown }>
  deterministic: boolean
}

// Legacy class for backward compatibility
export class DecisionTraceBuilder {
  private trace: DecisionTraceLegacy
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

  complete(): DecisionTraceLegacy {
    this.trace.completed_at = new Date().toISOString()
    return this.trace
  }

  getTrace(): DecisionTraceLegacy {
    return this.trace
  }
}

// Legacy class for backward compatibility
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

    const differences: ReplayResult['differences'] = []

    if (!verifyInputHashLegacy({ input: 'dummy' }, original.input_snapshot.hash)) {
      differences.push({
        field: 'input_snapshot.hash',
        original: original.input_snapshot.hash,
        replayed: 'would_recompute_on_replay',
      })
    }

    return {
      success: true,
      original,
      replayed: original,
      differences,
      deterministic: differences.length === 0,
    }
  }
}

// Legacy helper functions for backward compatibility
function canonicalizeObjectLegacy(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(canonicalizeObjectLegacy)
  }

  const sorted: Record<string, unknown> = {}
  const keys = Object.keys(obj as Record<string, unknown>).sort()

  for (const key of keys) {
    sorted[key] = canonicalizeObjectLegacy((obj as Record<string, unknown>)[key])
  }

  return sorted
}

export function canonicalizeJson(input: unknown): string {
  const canonical = canonicalizeObjectLegacy(input)
  return JSON.stringify(canonical, null, 0)
}

export function hashCanonicalJson(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson).digest('hex')
}

function extractKeysLegacy(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') {
    return []
  }

  if (Array.isArray(obj)) {
    return obj.flatMap((item, idx) => extractKeysLegacy(item, `${prefix}[${idx}]`))
  }

  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    keys.push(fullKey)

    if (typeof value === 'object' && value !== null) {
      keys.push(...extractKeysLegacy(value, fullKey))
    }
  }

  return keys
}

export interface CreateInputSnapshotOptions {
  redactKeys?: string[]
  includeMetadata?: boolean
}

export function createInputSnapshot(
  invocationId: string,
  input: Record<string, unknown>,
  options?: CreateInputSnapshotOptions
): InputSnapshotLegacy {
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

  const snapshot: InputSnapshotLegacy = {
    invocation_id: invocationId,
    timestamp: new Date().toISOString(),
    canonical_json: canonicalJson,
    hash: hashCanonicalJson(canonicalJson),
    algorithm: 'sha256',
    original_size_bytes: Buffer.byteLength(originalJson, 'utf8'),
    canonical_size_bytes: Buffer.byteLength(canonicalJson, 'utf8'),
    input_keys: extractKeysLegacy(input),
    redacted_keys: options?.redactKeys,
  }

  return snapshot
}

export function verifyInputHash(input: Record<string, unknown>, expectedHash: string): boolean {
  const canonicalJson = canonicalizeJson(input)
  const actualHash = hashCanonicalJson(canonicalJson)
  return actualHash === expectedHash
}

function verifyInputHashLegacy(input: Record<string, unknown>, expectedHash: string): boolean {
  return verifyInputHash(input, expectedHash)
}

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

export function verifyOutputHash(output: unknown, expectedHash: string): boolean {
  const outputJson = typeof output === 'string' ? output : JSON.stringify(output)
  const actualHash = createHash('sha256').update(outputJson).digest('hex')
  return actualHash === expectedHash
}

import { z } from 'zod'

// Schemas for backward compatibility
export const DecisionStepSchema = z.object({
  step_id: z.string().min(1),
  timestamp: z.string().datetime(),
  decision: z.string().min(1),
  reason: z.string(),
  input_context: z.record(z.unknown()),
  output_context: z.record(z.unknown()),
  duration_ms: z.number().nonnegative(),
})

export const DecisionTraceSchema = z.object({
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

export const InputSnapshotSchema = z.object({
  invocation_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  canonical_json: z.string(),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  algorithm: z.literal('sha256'),
  original_size_bytes: z.number().nonnegative(),
  canonical_size_bytes: z.number().nonnegative(),
  input_keys: z.array(z.string()),
  redacted_keys: z.array(z.string()).optional(),
})

export const OutputArtifactSchema = z.object({
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

export const InvocationContextSchema = z.object({
  invocation_id: z.string().uuid(),
  trace_id: z.string().min(1),
  job_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  runner_id: z.string().min(1),
  runner_type: z.enum(['ops', 'finops', 'support', 'growth']),
  started_at: z.string().datetime(),
  attempt_no: z.number().int().positive(),
})

export const InvocationRecordSchema = z.object({
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

export function validateInvocationRecord(record: unknown): DeterminismValidation {
  const errors: string[] = []
  const warnings: string[] = []

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

  const inputValid = verifyInputHash(
    JSON.parse(validRecord.input_snapshot.canonical_json),
    validRecord.input_snapshot.hash
  )

  if (!inputValid) {
    errors.push('input_snapshot: hash mismatch - data may have been tampered with')
  }

  let traceValid = true
  if (validRecord.status === 'completed' && !validRecord.decision_trace.final_decision) {
    errors.push('decision_trace: completed invocation missing final_decision')
    traceValid = false
  }

  if (validRecord.decision_trace.steps.length === 0) {
    warnings.push('decision_trace: no steps recorded')
  }

  let artifactValid = true
  if (validRecord.output_artifact) {
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
