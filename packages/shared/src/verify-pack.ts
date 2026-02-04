/**
 * ReadyLayer Verify Pack Job Handler
 * Performs local verification of a codebase without network requirements
 *
 * Job Type: autopilot.readylayer.verify_pack
 *
 * Feature Flags Required:
 * - VERIFY_PACK_ENABLED=1
 * - JOBFORGE_AUTOPILOT_JOBS_ENABLED=1
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { createHash } from 'crypto'
import { resolve, isAbsolute } from 'path'
import { z } from 'zod'
import type { JobContext } from './types.js'
import type {
  ArtifactManifest,
  ArtifactOutput,
  EnvFingerprint,
  ToolVersions,
} from './execution-plane/manifests.js'
import { SCHEMA_VERSION } from '@autopilot/contracts'

// ============================================================================
// Zod Schemas
// ============================================================================

export const VerifyPackPayloadSchema = z.object({
  repoPath: z.string().optional(),
  repoRef: z.string().optional(),
  pack: z.enum(['fast', 'full']).default('fast'),
  options: z
    .object({
      skipLint: z.boolean().optional(),
      skipTypecheck: z.boolean().optional(),
      skipBuild: z.boolean().optional(),
      skipTest: z.boolean().optional(),
      customCommands: z.array(z.string()).optional(),
      env: z.record(z.string()).optional(),
    })
    .optional(),
})

export type VerifyPackPayload = z.infer<typeof VerifyPackPayloadSchema>

// ============================================================================
// Output Types
// ============================================================================

export interface CommandResult {
  command: string
  success: boolean
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
  skipped?: boolean
  reason?: string
}

export interface VerifyReport {
  repo_path: string
  pack: 'fast' | 'full'
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
    duration_ms: number
  }
  commands: CommandResult[]
  fingerprints: {
    package_json_hash: string | null
    lockfile_hash: string | null
    file_count: number
    total_size_bytes: number
  }
  issues: Array<{
    severity: 'error' | 'warning'
    message: string
    command?: string
  }>
  generated_at: string
}

export interface VerifyPackResult {
  success: boolean
  report: VerifyReport
  manifest: ArtifactManifest
  artifact_ref?: string
}

// ============================================================================
// Feature Flag Check (Dynamic - checks at runtime, not import time)
// ============================================================================

function checkFeatureFlags(): { enabled: true } | { enabled: false; reason: string } {
  // Check environment variables at runtime (not cached at import)
  const autopilotEnabled =
    process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED === '1' ||
    process.env.JOBFORGE_AUTOPILOT_JOBS_ENABLED?.toLowerCase() === 'true'

  const verifyPackEnabled =
    process.env.VERIFY_PACK_ENABLED === '1' ||
    process.env.VERIFY_PACK_ENABLED?.toLowerCase() === 'true'

  if (!autopilotEnabled) {
    return {
      enabled: false,
      reason: 'JOBFORGE_AUTOPILOT_JOBS_ENABLED is not enabled (set to 1 to enable)',
    }
  }

  if (!verifyPackEnabled) {
    return {
      enabled: false,
      reason: 'VERIFY_PACK_ENABLED is not enabled (set to 1 to enable)',
    }
  }

  return { enabled: true }
}

// ============================================================================
// Helper Functions
// ============================================================================

function resolveRepoPath(repoPath?: string, repoRef?: string): string {
  // If repoPath is provided, use it
  if (repoPath) {
    const resolved = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath)

    if (!existsSync(resolved)) {
      throw new Error(`Repository path does not exist: ${resolved}`)
    }
    return resolved
  }

  // If repoRef is provided (format: "local:/path/to/repo"), extract path
  if (repoRef) {
    if (repoRef.startsWith('local:')) {
      const localPath = repoRef.replace('local:', '')
      if (!existsSync(localPath)) {
        throw new Error(`Local repository reference does not exist: ${localPath}`)
      }
      return localPath
    }
    throw new Error(
      'Network-based repoRef not supported in offline mode. Use repoPath or local: prefix.'
    )
  }

  // Default to current working directory
  return process.cwd()
}

function detectPackageManager(repoPath: string): 'pnpm' | 'npm' | 'yarn' {
  if (existsSync(`${repoPath}/pnpm-lock.yaml`)) {
    return 'pnpm'
  }
  if (existsSync(`${repoPath}/yarn.lock`)) {
    return 'yarn'
  }
  return 'npm'
}

function getRunCommand(packageManager: 'pnpm' | 'npm' | 'yarn', script: string): string {
  const commands: Record<string, Record<string, string>> = {
    pnpm: {
      lint: 'pnpm run lint',
      typecheck: 'pnpm run typecheck',
      build: 'pnpm run build',
      test: 'pnpm run test',
    },
    npm: {
      lint: 'npm run lint',
      typecheck: 'npm run typecheck',
      build: 'npm run build',
      test: 'npm run test',
    },
    yarn: {
      lint: 'yarn lint',
      typecheck: 'yarn typecheck',
      build: 'yarn build',
      test: 'yarn test',
    },
  }
  return commands[packageManager][script] || `${packageManager} run ${script}`
}

function runCommand(command: string, cwd: string, env?: Record<string, string>): CommandResult {
  const startTime = Date.now()

  try {
    const result = execSync(command, {
      cwd,
      encoding: 'utf-8',
      timeout: 300_000, // 5 minute timeout
      env: {
        ...process.env,
        ...env,
        CI: 'true',
        NODE_ENV: 'test',
      },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    })

    return {
      command,
      success: true,
      exitCode: 0,
      stdout: result.substring(0, 100_000), // Limit output size
      stderr: '',
      durationMs: Date.now() - startTime,
    }
  } catch (error: unknown) {
    const execError = error as {
      status?: number
      stdout?: string
      stderr?: string
      message?: string
    }

    return {
      command,
      success: false,
      exitCode: execError.status ?? 1,
      stdout: (execError.stdout ?? '').substring(0, 100_000),
      stderr: (execError.stderr ?? execError.message ?? '').substring(0, 100_000),
      durationMs: Date.now() - startTime,
    }
  }
}

function detectAvailableScripts(packageJsonPath: string): string[] {
  if (!existsSync(packageJsonPath)) {
    return []
  }

  try {
    const content = readFileSync(packageJsonPath, 'utf-8')
    const pkg = JSON.parse(content)
    return Object.keys(pkg.scripts || {})
  } catch {
    return []
  }
}

function computeFileHash(filePath: string): string | null {
  try {
    const content = readFileSync(filePath)
    return createHash('sha256').update(content).digest('hex').substring(0, 16)
  } catch {
    return null
  }
}

function getDirectoryStats(dirPath: string): { count: number; size: number } {
  let count = 0
  let size = 0

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs')
    const entries = fs.readdirSync(dirPath, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (entry.isFile()) {
        count++
        try {
          const stats = statSync(`${entry.parentPath}/${entry.name}`)
          size += stats.size
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Return zeros if we can't read directory
  }

  return { count, size }
}

function generateFingerprints(repoPath: string): VerifyReport['fingerprints'] {
  const packageJsonPath = `${repoPath}/package.json`
  const pnpmLockPath = `${repoPath}/pnpm-lock.yaml`
  const yarnLockPath = `${repoPath}/yarn.lock`
  const packageLockPath = `${repoPath}/package-lock.json`

  let lockfileHash: string | null = null
  if (existsSync(pnpmLockPath)) {
    lockfileHash = computeFileHash(pnpmLockPath)
  } else if (existsSync(yarnLockPath)) {
    lockfileHash = computeFileHash(yarnLockPath)
  } else if (existsSync(packageLockPath)) {
    lockfileHash = computeFileHash(packageLockPath)
  }

  const { count, size } = getDirectoryStats(repoPath)

  return {
    package_json_hash: existsSync(packageJsonPath) ? computeFileHash(packageJsonPath) : null,
    lockfile_hash: lockfileHash,
    file_count: count,
    total_size_bytes: size,
  }
}

function generateToolVersions(packageManager: string): ToolVersions {
  return {
    jobforge: '0.2.0',
    connectors: {
      readylayer: '1.0.0',
    },
    package_manager: packageManager,
    node_version: process.version,
  }
}

function generateEnvFingerprint(): EnvFingerprint {
  return {
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function verifyPackHandler(
  payload: unknown,
  context: JobContext
): Promise<VerifyPackResult> {
  const startTime = Date.now()

  // Check feature flags first
  const flagCheck = checkFeatureFlags()
  if (!flagCheck.enabled) {
    return {
      success: false,
      report: {
        repo_path: '',
        pack: 'fast',
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 1,
          duration_ms: 0,
        },
        commands: [],
        fingerprints: {
          package_json_hash: null,
          lockfile_hash: null,
          file_count: 0,
          total_size_bytes: 0,
        },
        issues: [
          {
            severity: 'error',
            message: `Feature flag check failed: ${flagCheck.reason}`,
          },
        ],
        generated_at: new Date().toISOString(),
      },
      manifest: {
        schema_version: '1.0.0',
        manifest_version: '1.0',
        run_id: context.job_id,
        tenant_id: context.tenant_id,
        job_type: 'autopilot.readylayer.verify_pack',
        created_at: new Date().toISOString(),
        inputs_snapshot_ref: undefined,
        logs_ref: undefined,
        outputs: [],
        metrics: {
          duration_ms: 0,
        },
        env_fingerprint: generateEnvFingerprint(),
        tool_versions: {
          jobforge: '0.2.0',
        },
        status: 'failed',
        error: {
          message: `Feature flag check failed: ${flagCheck.reason}`,
          code: 'FEATURE_FLAG_DISABLED',
        },
      },
    }
  }

  try {
    // Validate payload
    const validated = VerifyPackPayloadSchema.parse(payload)

    // Resolve repository path
    const repoPath = resolveRepoPath(validated.repoPath, validated.repoRef)

    // Detect package manager and available scripts
    const packageManager = detectPackageManager(repoPath)
    const availableScripts = detectAvailableScripts(`${repoPath}/package.json`)

    // Determine which commands to run
    const commands: CommandResult[] = []
    const issues: VerifyReport['issues'] = []
    const options = validated.options || {}

    // Fast pack commands: lint, typecheck, build
    if (!options.skipLint && availableScripts.includes('lint')) {
      const result = runCommand(getRunCommand(packageManager, 'lint'), repoPath, options.env)
      commands.push(result)
      if (!result.success) {
        issues.push({
          severity: 'error',
          message: `Lint failed with exit code ${result.exitCode}`,
          command: result.command,
        })
      }
    } else if (!availableScripts.includes('lint')) {
      commands.push({
        command: getRunCommand(packageManager, 'lint'),
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        skipped: true,
        reason: 'lint script not found in package.json',
      })
    }

    if (!options.skipTypecheck && availableScripts.includes('typecheck')) {
      const result = runCommand(getRunCommand(packageManager, 'typecheck'), repoPath, options.env)
      commands.push(result)
      if (!result.success) {
        issues.push({
          severity: 'error',
          message: `Typecheck failed with exit code ${result.exitCode}`,
          command: result.command,
        })
      }
    } else if (!availableScripts.includes('typecheck')) {
      commands.push({
        command: getRunCommand(packageManager, 'typecheck'),
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        skipped: true,
        reason: 'typecheck script not found in package.json',
      })
    }

    if (!options.skipBuild && availableScripts.includes('build')) {
      const result = runCommand(getRunCommand(packageManager, 'build'), repoPath, options.env)
      commands.push(result)
      if (!result.success) {
        issues.push({
          severity: 'error',
          message: `Build failed with exit code ${result.exitCode}`,
          command: result.command,
        })
      }
    } else if (!availableScripts.includes('build')) {
      commands.push({
        command: getRunCommand(packageManager, 'build'),
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 0,
        skipped: true,
        reason: 'build script not found in package.json',
      })
    }

    // Full pack adds: tests
    if (validated.pack === 'full') {
      if (!options.skipTest && availableScripts.includes('test')) {
        const result = runCommand(getRunCommand(packageManager, 'test'), repoPath, options.env)
        commands.push(result)
        if (!result.success) {
          issues.push({
            severity: 'error',
            message: `Tests failed with exit code ${result.exitCode}`,
            command: result.command,
          })
        }
      } else if (!availableScripts.includes('test')) {
        commands.push({
          command: getRunCommand(packageManager, 'test'),
          success: true,
          exitCode: 0,
          stdout: '',
          stderr: '',
          durationMs: 0,
          skipped: true,
          reason: 'test script not found in package.json',
        })
      }
    }

    // Run custom commands if provided
    if (options.customCommands) {
      for (const customCmd of options.customCommands) {
        const result = runCommand(customCmd, repoPath, options.env)
        commands.push(result)
        if (!result.success) {
          issues.push({
            severity: 'error',
            message: `Custom command failed: ${customCmd}`,
            command: customCmd,
          })
        }
      }
    }

    // Calculate summary
    const totalDuration = commands.reduce((sum, cmd) => sum + cmd.durationMs, 0)
    const passed = commands.filter((cmd) => cmd.success && !cmd.skipped).length
    const failed = commands.filter((cmd) => !cmd.success && !cmd.skipped).length
    const skipped = commands.filter((cmd) => cmd.skipped).length

    // Generate report
    const report: VerifyReport = {
      repo_path: repoPath,
      pack: validated.pack,
      summary: {
        total: commands.length,
        passed,
        failed,
        skipped,
        duration_ms: totalDuration,
      },
      commands,
      fingerprints: generateFingerprints(repoPath),
      issues,
      generated_at: new Date().toISOString(),
    }

    // Generate manifest
    const outputs: ArtifactOutput[] = [
      {
        name: 'verify_report',
        type: 'json',
        ref: `verify-report-${context.job_id}.json`,
        size: JSON.stringify(report).length,
        mime_type: 'application/json',
      },
    ]

    // If there are issues, add them as a separate output
    if (issues.length > 0) {
      outputs.push({
        name: 'issues_log',
        type: 'json',
        ref: `issues-${context.job_id}.json`,
        size: JSON.stringify(issues).length,
        mime_type: 'application/json',
      })
    }

    const manifest: ArtifactManifest = {
      schema_version: SCHEMA_VERSION,
      manifest_version: '1.0',
      run_id: context.job_id,
      tenant_id: context.tenant_id,
      job_type: 'autopilot.readylayer.verify_pack',
      created_at: new Date().toISOString(),
      inputs_snapshot_ref: undefined,
      logs_ref: `logs/verify-pack-${context.job_id}.log`,
      outputs,
      metrics: {
        duration_ms: Date.now() - startTime,
        file_count: report.fingerprints.file_count,
        total_size_bytes: report.fingerprints.total_size_bytes,
      },
      env_fingerprint: generateEnvFingerprint(),
      tool_versions: generateToolVersions(packageManager),
      status: failed === 0 ? 'complete' : 'failed',
      error: failed > 0 ? { issues, failed_count: failed } : undefined,
    }

    return {
      success: failed === 0,
      report,
      manifest,
      artifact_ref: outputs[0].ref,
    }
  } catch (error: unknown) {
    // Never throw - always return structured result
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'

    const failedReport: VerifyReport = {
      repo_path:
        typeof payload === 'object' && payload !== null && 'repoPath' in payload
          ? String((payload as { repoPath?: string }).repoPath || '')
          : '',
      pack: 'fast',
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        duration_ms: Date.now() - startTime,
      },
      commands: [],
      fingerprints: {
        package_json_hash: null,
        lockfile_hash: null,
        file_count: 0,
        total_size_bytes: 0,
      },
      issues: [
        {
          severity: 'error',
          message: errorMessage,
        },
      ],
      generated_at: new Date().toISOString(),
    }

    const failedManifest: ArtifactManifest = {
      schema_version: SCHEMA_VERSION,
      manifest_version: '1.0',
      run_id: context.job_id,
      tenant_id: context.tenant_id,
      job_type: 'autopilot.readylayer.verify_pack',
      created_at: new Date().toISOString(),
      inputs_snapshot_ref: undefined,
      logs_ref: undefined,
      outputs: [],
      metrics: {
        duration_ms: Date.now() - startTime,
      },
      env_fingerprint: generateEnvFingerprint(),
      tool_versions: {
        jobforge: '0.2.0',
      },
      status: 'failed',
      error: {
        message: errorMessage,
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        stack: error instanceof Error ? error.stack : undefined,
      },
    }

    return {
      success: false,
      report: failedReport,
      manifest: failedManifest,
    }
  }
}
