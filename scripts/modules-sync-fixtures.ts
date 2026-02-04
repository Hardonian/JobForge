#!/usr/bin/env node
/**
 * Sync module fixture outputs into JobForge fixtures/modules.
 */

import { promises as fs } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const MODULES = ['ops', 'support', 'growth', 'finops'] as const

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outputRoot = path.join(repoRoot, 'packages', 'shared', 'test', 'fixtures', 'modules')

function parseModuleRepoPaths(): Record<string, string> {
  const repoMap: Record<string, string> = {}

  if (process.env.JOBFORGE_MODULE_REPOS) {
    try {
      const parsed = JSON.parse(process.env.JOBFORGE_MODULE_REPOS)
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string' && value.length > 0) {
            repoMap[key] = value
          }
        }
      }
    } catch (error) {
      throw new Error(`Invalid JOBFORGE_MODULE_REPOS JSON: ${String(error)}`)
    }
  }

  for (const moduleName of MODULES) {
    const envKey = `JOBFORGE_MODULE_${moduleName.toUpperCase()}_REPO`
    const envValue = process.env[envKey]
    if (envValue && envValue.length > 0) {
      repoMap[moduleName] = envValue
    }
  }

  return repoMap
}

async function ensureCleanDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true })
  await fs.mkdir(dirPath, { recursive: true })
}

async function listJsonFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = await listJsonFiles(path.join(dirPath, entry.name))
      files.push(...nested)
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(path.join(dirPath, entry.name))
    }
  }
  return files
}

async function copyFixtures(sourceDir: string, destDir: string): Promise<number> {
  const files = await listJsonFiles(sourceDir)
  await ensureCleanDir(destDir)
  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath)
    const destPath = path.join(destDir, relativePath)
    await fs.mkdir(path.dirname(destPath), { recursive: true })
    await fs.copyFile(filePath, destPath)
  }
  return files.length
}

async function syncModuleFixtures(): Promise<void> {
  const repoMap = parseModuleRepoPaths()
  const modulesConfigured = Object.keys(repoMap).length > 0

  if (!modulesConfigured) {
    console.log('No module repo paths configured; using JobForge fixtures as-is.')
    return
  }

  await fs.mkdir(outputRoot, { recursive: true })

  for (const moduleName of MODULES) {
    const repoPath = repoMap[moduleName]
    const destDir = path.join(outputRoot, moduleName)

    if (!repoPath) {
      console.log(`No repo path configured for ${moduleName}; leaving local fixtures in place.`)
      continue
    }

    const resolvedRepo = path.isAbsolute(repoPath) ? repoPath : path.resolve(repoRoot, repoPath)
    const sourceDir = path.join(resolvedRepo, 'fixtures', 'jobforge')

    try {
      const stat = await fs.stat(sourceDir)
      if (!stat.isDirectory()) {
        throw new Error('path is not a directory')
      }
    } catch (error) {
      throw new Error(`Missing fixtures for ${moduleName} at ${sourceDir}: ${String(error)}`)
    }

    const copied = await copyFixtures(sourceDir, destDir)
    console.log(`Synced ${copied} fixture(s) for ${moduleName} from ${sourceDir}`)
  }
}

syncModuleFixtures().catch((error) => {
  console.error(`Fixture sync failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
