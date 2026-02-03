/**
 * JobForge Upgrade Lane
 *
 * Version negotiation and compatibility management for JobRequestBundles.
 * Ensures module schema changes don't break JobForge.
 *
 * Feature flag: JOBFORGE_UPGRADE_LANE_ENABLED=1
 * Default: OFF
 */

import { z } from 'zod'
import { readFile, access } from 'fs/promises'

// ============================================================================
// Version Schemas
// ============================================================================

/**
 * Semantic version schema
 */
export const SemVerSchema = z.string().regex(/^\d+\.\d+\.\d+$/)
export type SemVer = z.infer<typeof SemVerSchema>

/**
 * Bundle version info
 */
export const BundleVersionSchema = z.object({
  schema_version: SemVerSchema,
  jobforge_version: SemVerSchema.optional(),
  sdk_version: SemVerSchema.optional(),
})
export type BundleVersion = z.infer<typeof BundleVersionSchema>

/**
 * Re-export JobRequestBundle from execution-plane
 */
import { JobRequestBundleSchema, type JobRequestBundle } from './execution-plane/schemas.js'
export { JobRequestBundleSchema, JobRequestBundle }

// ============================================================================
// Version Support Matrix
// ============================================================================

/**
 * Supported version ranges
 * Update these when releasing new versions
 */
export const SUPPORTED_VERSIONS = {
  // Current JobForge version
  CURRENT: '1.0.0' as SemVer,

  // Minimum supported bundle schema version
  MIN_BUNDLE_VERSION: '1.0.0' as SemVer,

  // Maximum supported bundle schema version
  MAX_BUNDLE_VERSION: '1.1.0' as SemVer,

  // Supported schema versions for N-1 compatibility
  SUPPORTED_SCHEMA_VERSIONS: ['1.0.0', '1.1.0'] as SemVer[],
}

// ============================================================================
// Version Utilities
// ============================================================================

/**
 * Parse semantic version string
 */
export function parseVersion(
  version: string
): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null

  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

/**
 * Compare two semantic versions
 * Returns: -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareVersions(a: SemVer, b: SemVer): number {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)

  if (!parsedA || !parsedB) {
    throw new Error(`Invalid version format: ${!parsedA ? a : b}`)
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1
  }

  if (parsedA.minor !== parsedB.minor) {
    return parsedA.minor > parsedB.minor ? 1 : -1
  }

  if (parsedA.patch !== parsedB.patch) {
    return parsedA.patch > parsedB.patch ? 1 : -1
  }

  return 0
}

/**
 * Check if version is within range
 */
export function isVersionSupported(
  version: SemVer,
  minVersion: SemVer,
  maxVersion: SemVer
): boolean {
  try {
    return compareVersions(version, minVersion) >= 0 && compareVersions(version, maxVersion) <= 0
  } catch {
    return false
  }
}

/**
 * Check if schema version is supported
 */
export function isSchemaVersionSupported(schemaVersion: SemVer): boolean {
  return SUPPORTED_VERSIONS.SUPPORTED_SCHEMA_VERSIONS.includes(schemaVersion)
}

// ============================================================================
// Compatibility Checker
// ============================================================================

export interface CompatibilityResult {
  compatible: boolean
  reason: string
  suggestedAction: string
  canMigrate: boolean
  migrationPath?: string
}

export interface BundleValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  bundleVersion?: BundleVersion
}

/**
 * Validate bundle version
 */
export function validateBundleVersion(bundle: unknown): BundleValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // First, check if it's a valid object
  if (!bundle || typeof bundle !== 'object') {
    return {
      valid: false,
      errors: ['Bundle must be a valid object'],
      warnings,
    }
  }

  const bundleObj = bundle as Record<string, unknown>

  let version: BundleVersion | null = null

  if (typeof bundleObj.schema_version === 'string') {
    const schemaVersionParse = SemVerSchema.safeParse(bundleObj.schema_version)
    if (!schemaVersionParse.success) {
      errors.push(`Invalid schema_version format: ${JSON.stringify(bundleObj.schema_version)}`)
      errors.push('schema_version must be a semantic version (e.g., "1.0.0")')
      return { valid: false, errors, warnings }
    }

    version = {
      schema_version: schemaVersionParse.data,
    }
  } else if (bundleObj.version) {
    const versionParse = BundleVersionSchema.safeParse(bundleObj.version)
    if (!versionParse.success) {
      errors.push(`Invalid version format: ${JSON.stringify(bundleObj.version)}`)
      errors.push('Version must include schema_version (e.g., "1.0.0")')
      return { valid: false, errors, warnings }
    }
    warnings.push('Bundle uses legacy version object; prefer schema_version on the root bundle.')
    version = versionParse.data
  } else {
    errors.push('Bundle missing required field: schema_version')
    return { valid: false, errors, warnings }
  }

  // Check schema version compatibility
  if (!isSchemaVersionSupported(version.schema_version)) {
    errors.push(
      `Unsupported schema version: ${version.schema_version}. ` +
        `Supported versions: ${SUPPORTED_VERSIONS.SUPPORTED_SCHEMA_VERSIONS.join(', ')}`
    )
  }

  // Check if within supported range
  if (
    !isVersionSupported(
      version.schema_version,
      SUPPORTED_VERSIONS.MIN_BUNDLE_VERSION,
      SUPPORTED_VERSIONS.MAX_BUNDLE_VERSION
    )
  ) {
    errors.push(
      `Schema version ${version.schema_version} is outside supported range ` +
        `[${SUPPORTED_VERSIONS.MIN_BUNDLE_VERSION} - ${SUPPORTED_VERSIONS.MAX_BUNDLE_VERSION}]`
    )
  }

  // Warn about deprecated versions
  if (version.schema_version === '0.9.0') {
    warnings.push('Schema version 0.9.0 is deprecated and will be removed in future releases')
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    bundleVersion: version,
  }
}

/**
 * Check bundle compatibility
 */
export function checkCompatibility(bundle: JobRequestBundle): CompatibilityResult {
  const validation = validateBundleVersion(bundle)

  if (!validation.valid) {
    return {
      compatible: false,
      reason: `Validation failed: ${validation.errors.join('; ')}`,
      suggestedAction: 'Fix bundle version or upgrade module',
      canMigrate: false,
    }
  }

  const schemaVersion = validation.bundleVersion!.schema_version
  const version = parseVersion(schemaVersion)

  if (!version) {
    return {
      compatible: false,
      reason: 'Failed to parse schema version',
      suggestedAction: 'Check version format',
      canMigrate: false,
    }
  }

  // Check for major version compatibility
  const current = parseVersion(SUPPORTED_VERSIONS.CURRENT)!

  if (version.major < current.major) {
    // N-1 support
    return {
      compatible: true,
      reason: `Schema version ${schemaVersion} is supported (N-1 compatibility)`,
      suggestedAction: 'Consider upgrading to latest schema version',
      canMigrate: true,
      migrationPath: 'Automatic migration available',
    }
  }

  if (version.major > current.major) {
    return {
      compatible: false,
      reason: `Schema version ${schemaVersion} is from a future major version`,
      suggestedAction: 'Upgrade JobForge to support this bundle version',
      canMigrate: false,
    }
  }

  // Same major version
  if (version.minor > current.minor) {
    return {
      compatible: false,
      reason: `Schema version ${schemaVersion} requires newer features`,
      suggestedAction: 'Upgrade JobForge to support this bundle version',
      canMigrate: false,
    }
  }

  return {
    compatible: true,
    reason: `Schema version ${schemaVersion} is fully compatible`,
    suggestedAction: 'No action required',
    canMigrate: version.minor < current.minor,
  }
}

// ============================================================================
// Migration Support
// ============================================================================

export interface MigrationInfo {
  fromVersion: SemVer
  toVersion: SemVer
  steps: string[]
  breaking: boolean
}

/**
 * Get migration info between versions
 */
export function getMigrationInfo(fromVersion: SemVer, toVersion: SemVer): MigrationInfo | null {
  // Define known migrations
  const migrations: Record<string, MigrationInfo> = {
    '1.0.0-to-1.1.0': {
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
      steps: [
        'Add "metadata.execution_context" field (optional)',
        'Update "jobs[].priority" to use new enum values',
        'No breaking changes',
      ],
      breaking: false,
    },
  }

  const key = `${fromVersion}-to-${toVersion}`
  return migrations[key] || null
}

/**
 * Check if migration is needed
 */
export function needsMigration(bundleVersion: SemVer): boolean {
  return compareVersions(bundleVersion, SUPPORTED_VERSIONS.CURRENT) < 0
}

/**
 * Get suggested migration path
 */
export function getSuggestedMigration(currentVersion: SemVer): MigrationInfo | null {
  return getMigrationInfo(currentVersion, SUPPORTED_VERSIONS.CURRENT)
}

// ============================================================================
// Compatibility Test Matrix
// ============================================================================

export interface CompatibilityTestCase {
  name: string
  bundleVersion: SemVer
  expectedCompatible: boolean
  description: string
}

/**
 * Get compatibility test cases for CI
 */
export function getCompatibilityTestCases(): CompatibilityTestCase[] {
  return [
    {
      name: 'current_version',
      bundleVersion: SUPPORTED_VERSIONS.CURRENT,
      expectedCompatible: true,
      description: 'Current schema version should be compatible',
    },
    {
      name: 'n_minus_1',
      bundleVersion: '1.0.0',
      expectedCompatible: true,
      description: 'N-1 version should be compatible (backwards compatibility)',
    },
    {
      name: 'n_minus_2',
      bundleVersion: '0.9.0',
      expectedCompatible: false,
      description: 'N-2 version should fail (only N-1 supported)',
    },
    {
      name: 'future_minor',
      bundleVersion: '1.2.0',
      expectedCompatible: false,
      description: 'Future minor version should fail',
    },
    {
      name: 'future_major',
      bundleVersion: '2.0.0',
      expectedCompatible: false,
      description: 'Future major version should fail',
    },
    {
      name: 'invalid_version',
      bundleVersion: 'invalid' as SemVer,
      expectedCompatible: false,
      description: 'Invalid version format should fail',
    },
  ]
}

// ============================================================================
// MIGRATION.md Template
// ============================================================================

export const MIGRATION_TEMPLATE = `# JobForge Migration Guide

## Version {FROM_VERSION} → {TO_VERSION}

**Date**: {DATE}
**Breaking Changes**: {BREAKING}

### Changes

{CHANGES}

### Migration Steps

{STEPS}

### Rollback

To rollback this migration:
{ROLLBACK_STEPS}

### Compatibility

- Minimum JobForge version: {MIN_JOBFORGE_VERSION}
- Supported bundle versions: {SUPPORTED_BUNDLE_VERSIONS}
- Migration path: {MIGRATION_PATH}

---
*Migration generated by JobForge Upgrade Lane*
`

/**
 * Generate migration documentation
 */
export function generateMigrationDoc(
  fromVersion: SemVer,
  toVersion: SemVer,
  changes: string[],
  breaking: boolean
): string {
  const migrationInfo = getMigrationInfo(fromVersion, toVersion)

  return MIGRATION_TEMPLATE.replace('{FROM_VERSION}', fromVersion)
    .replace('{TO_VERSION}', toVersion)
    .replace('{DATE}', new Date().toISOString().split('T')[0])
    .replace('{BREAKING}', breaking ? 'YES ⚠️' : 'NO')
    .replace('{CHANGES}', changes.map((c) => `- ${c}`).join('\n'))
    .replace(
      '{STEPS}',
      migrationInfo?.steps.map((s) => `1. ${s}`).join('\n') || 'No migration steps required'
    )
    .replace('{ROLLBACK_STEPS}', breaking ? 'Restore from backup' : 'Revert configuration changes')
    .replace('{MIN_JOBFORGE_VERSION}', SUPPORTED_VERSIONS.CURRENT)
    .replace('{SUPPORTED_BUNDLE_VERSIONS}', SUPPORTED_VERSIONS.SUPPORTED_SCHEMA_VERSIONS.join(', '))
    .replace('{MIGRATION_PATH}', migrationInfo ? 'Automated' : 'Manual')
}

// ============================================================================
// CLI Integration Helpers
// ============================================================================

export interface VersionCheckReport {
  timestamp: string
  bundlePath: string
  bundleVersion: BundleVersion | null
  compatible: boolean
  reason: string
  suggestedAction: string
  canMigrate: boolean
  migrationInfo: MigrationInfo | null
}

/**
 * Check bundle file compatibility
 */
export async function checkBundleFile(bundlePath: string): Promise<VersionCheckReport> {
  try {
    await access(bundlePath)
    const content = await readFile(bundlePath, 'utf-8')
    const bundle = JSON.parse(content) as JobRequestBundle

    const validation = validateBundleVersion(bundle)
    const compatibility = checkCompatibility(bundle)

    let migrationInfo: MigrationInfo | null = null
    if (validation.bundleVersion && needsMigration(validation.bundleVersion.schema_version)) {
      migrationInfo = getSuggestedMigration(validation.bundleVersion.schema_version)
    }

    return {
      timestamp: new Date().toISOString(),
      bundlePath,
      bundleVersion: validation.bundleVersion || null,
      compatible: compatibility.compatible,
      reason: compatibility.reason,
      suggestedAction: compatibility.suggestedAction,
      canMigrate: compatibility.canMigrate,
      migrationInfo,
    }
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      bundlePath,
      bundleVersion: null,
      compatible: false,
      reason: `Failed to load bundle: ${error instanceof Error ? error.message : String(error)}`,
      suggestedAction: 'Check file path and format',
      canMigrate: false,
      migrationInfo: null,
    }
  }
}

/**
 * Format version check report
 */
export function formatVersionReport(report: VersionCheckReport): string {
  const lines: string[] = []

  lines.push('='.repeat(60))
  lines.push('BUNDLE VERSION CHECK')
  lines.push('='.repeat(60))
  lines.push(`Bundle: ${report.bundlePath}`)
  lines.push(`Checked: ${report.timestamp}`)
  lines.push('')

  if (report.bundleVersion) {
    lines.push(`Schema Version: ${report.bundleVersion.schema_version}`)
    if (report.bundleVersion.jobforge_version) {
      lines.push(`JobForge Version: ${report.bundleVersion.jobforge_version}`)
    }
    lines.push('')
  }

  const statusIcon = report.compatible ? '✓' : '✗'
  lines.push(`Compatibility: ${statusIcon} ${report.compatible ? 'COMPATIBLE' : 'INCOMPATIBLE'}`)
  lines.push(`Reason: ${report.reason}`)
  lines.push('')

  lines.push(`Suggested Action: ${report.suggestedAction}`)

  if (report.canMigrate && report.migrationInfo) {
    lines.push('')
    lines.push('Migration Available:')
    lines.push(`  From: ${report.migrationInfo.fromVersion}`)
    lines.push(`  To: ${report.migrationInfo.toVersion}`)
    lines.push(`  Breaking: ${report.migrationInfo.breaking ? 'YES ⚠️' : 'NO'}`)
    lines.push('  Steps:')
    for (const step of report.migrationInfo.steps) {
      lines.push(`    - ${step}`)
    }
  }

  lines.push('')
  lines.push('='.repeat(60))

  return lines.join('\n')
}

/**
 * Run compatibility tests
 */
export function runCompatibilityTests(): {
  passed: number
  failed: number
  results: Array<{ name: string; passed: boolean; error?: string }>
} {
  const testCases = getCompatibilityTestCases()
  const results: Array<{ name: string; passed: boolean; error?: string }> = []

  for (const testCase of testCases) {
    try {
      const isSupported = isSchemaVersionSupported(testCase.bundleVersion)
      const passed = isSupported === testCase.expectedCompatible

      results.push({
        name: testCase.name,
        passed,
        error: passed
          ? undefined
          : `Expected compatible=${testCase.expectedCompatible}, got ${isSupported}`,
      })
    } catch (error) {
      results.push({
        name: testCase.name,
        passed: !testCase.expectedCompatible, // Error means incompatible
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    results,
  }
}
