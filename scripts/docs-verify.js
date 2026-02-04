const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const tsxPath = path.join(repoRoot, 'packages', 'shared', 'node_modules', '.bin', 'tsx')

const EXIT_CODES = {
  success: 0,
  failure: 1,
}

const QUICK_START_HEADING = '## Quick Start'
const MARKDOWN_FILE_CHECKS = [
  path.join(repoRoot, 'README.md'),
  path.join(repoRoot, 'CONTRIBUTING.md'),
  path.join(repoRoot, 'SUPPORT.md'),
]

const ALLOWED_EXTERNAL_COMMANDS = new Set(['supabase', 'psql', 'python', 'pip', 'pip3', 'node'])
const PNPM_BUILTINS = new Set(['install', 'add', 'exec', 'dlx', 'fetch', 'store'])

function runCommand(label, command, args, options = {}) {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })
    if (!output.trim()) {
      throw new Error('Command returned empty output')
    }
    return output
  } catch (error) {
    const message = error && error.stderr ? error.stderr.toString() : error.message
    throw new Error(`${label} failed: ${message}`)
  }
}

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} output mismatch`)
  }
}

function assertFileEqual(label, actualPath, expectedPath) {
  const actual = fs.readFileSync(actualPath, 'utf-8').trimEnd()
  const expected = fs.readFileSync(expectedPath, 'utf-8').trimEnd()
  assertEqual(label, actual, expected)
}

function assertNoPlaceholders(markdownPath) {
  const contents = fs.readFileSync(markdownPath, 'utf-8')
  if (/\bTODO\b|\bTBD\b/i.test(contents)) {
    throw new Error(`Placeholder markers found in ${path.relative(repoRoot, markdownPath)}`)
  }
}

function collectMarkdownLinks(markdownPath) {
  const contents = fs.readFileSync(markdownPath, 'utf-8')
  const linkRegex = /\[[^\]]+\]\(([^)]+)\)/g
  const links = []
  let match
  while ((match = linkRegex.exec(contents)) !== null) {
    links.push(match[1])
  }
  return links
}

function assertLocalLinksExist(markdownPath) {
  const links = collectMarkdownLinks(markdownPath)
  for (const link of links) {
    if (link.startsWith('http://') || link.startsWith('https://') || link.startsWith('mailto:')) {
      continue
    }
    if (link.startsWith('#')) {
      continue
    }
    const [linkPath] = link.split('#')
    const resolvedPath = path.resolve(repoRoot, linkPath)
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(
        `Broken link in ${path.relative(repoRoot, markdownPath)}: ${linkPath} not found`
      )
    }
  }
}

function extractQuickStartCommands(readmePath) {
  const contents = fs.readFileSync(readmePath, 'utf-8')
  const quickStartIndex = contents.indexOf(QUICK_START_HEADING)
  if (quickStartIndex === -1) {
    throw new Error('Quick Start section not found in README.md')
  }
  const afterHeading = contents.slice(quickStartIndex + QUICK_START_HEADING.length)
  const nextHeadingIndex = afterHeading.search(/\n##\s+/)
  const section =
    nextHeadingIndex === -1 ? afterHeading : afterHeading.slice(0, nextHeadingIndex)
  const codeFenceRegex = /```(?:bash|shell|sh)?\n([\s\S]*?)```/g
  const commands = []
  let match
  while ((match = codeFenceRegex.exec(section)) !== null) {
    const block = match[1]
    const lines = block.split('\n')
    let current = ''
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) {
        continue
      }
      if (line.endsWith('\\')) {
        current += `${line.slice(0, -1)} `
        continue
      }
      const command = `${current}${line}`.trim()
      if (command) {
        commands.push(command)
      }
      current = ''
    }
  }
  return commands
}

function normalizeCommandTokens(command) {
  const tokens = command.split(/\s+/)
  const filtered = []
  for (const token of tokens) {
    if (/^[A-Z0-9_]+=/.test(token)) {
      continue
    }
    filtered.push(token)
  }
  return filtered
}

function assertQuickStartCommands(readmePath) {
  const commands = extractQuickStartCommands(readmePath)
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'))
  const scripts = packageJson.scripts || {}

  for (const command of commands) {
    const tokens = normalizeCommandTokens(command)
    const executable = tokens[0]

    if (!executable) {
      continue
    }

    if (executable === 'cd') {
      const target = tokens[1]
      if (!target) {
        throw new Error(`Quick Start command missing path: ${command}`)
      }
      const resolved = path.resolve(repoRoot, target)
      if (!fs.existsSync(resolved)) {
        throw new Error(`Quick Start path not found: ${target}`)
      }
      continue
    }

    if (executable === 'pnpm') {
      const pnpmCommand = tokens[1]
      if (!pnpmCommand) {
        throw new Error(`Quick Start pnpm command missing: ${command}`)
      }
      if (pnpmCommand === 'run') {
        const scriptName = tokens[2]
        if (!scriptName || !scripts[scriptName]) {
          throw new Error(`Quick Start pnpm script not found: ${scriptName}`)
        }
        continue
      }
      if (PNPM_BUILTINS.has(pnpmCommand)) {
        continue
      }
      if (scripts[pnpmCommand]) {
        continue
      }
      throw new Error(`Quick Start pnpm command not recognized: ${pnpmCommand}`)
    }

    if (ALLOWED_EXTERNAL_COMMANDS.has(executable)) {
      continue
    }

    throw new Error(`Quick Start command uses unknown executable: ${executable}`)
  }
}

function main() {
  if (!fs.existsSync(tsxPath)) {
    throw new Error(`tsx binary not found at ${tsxPath}`)
  }

  for (const markdownPath of MARKDOWN_FILE_CHECKS) {
    assertNoPlaceholders(markdownPath)
    assertLocalLinksExist(markdownPath)
  }
  assertQuickStartCommands(path.join(repoRoot, 'README.md'))

  const helpChecks = [
    {
      label: 'jobforge-doctor --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'jobforge-doctor.ts'), '--help'],
    },
    {
      label: 'jobforge-impact --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'jobforge-impact.ts'), '--help'],
    },
    {
      label: 'jobforge-daily --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'jobforge-daily.ts'), '--help'],
    },
    {
      label: 'replay-cli --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'replay-cli.ts'), '--help'],
    },
    {
      label: 'worker-ts cli --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'services', 'worker-ts', 'src', 'cli.ts'), '--help'],
    },
    {
      label: 'worker-ts console --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'services', 'worker-ts', 'src', 'console.ts'), '--help'],
    },
    {
      label: 'worker-py --help',
      command: 'python',
      args: ['-m', 'jobforge_worker.cli', '--help'],
      options: {
        cwd: path.join(repoRoot, 'services', 'worker-py'),
        env: {
          ...process.env,
          PYTHONPATH: path.join(repoRoot, 'services', 'worker-py', 'src'),
        },
      },
    },
    {
      label: 'contract-test-runner --help',
      command: tsxPath,
      args: [
        path.join(repoRoot, 'packages', 'shared', 'test', 'contract-test-runner.ts'),
        '--help',
      ],
    },
    {
      label: 'smoke-test-autopilot --help',
      command: 'node',
      args: [path.join(repoRoot, 'scripts', 'smoke-test-autopilot.js'), '--help'],
    },
    {
      label: 'prove-autopilot-integration --help',
      command: 'node',
      args: [path.join(repoRoot, 'scripts', 'prove-autopilot-integration.js'), '--help'],
    },
    {
      label: 'smoke-test-final --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'smoke-test-final.ts'), '--help'],
    },
    {
      label: 'smoke-test-verify-pack --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'smoke-test-verify-pack.ts'), '--help'],
    },
    {
      label: 'smoke-test-execution-plane --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'smoke-test-execution-plane.ts'), '--help'],
    },
    {
      label: 'mcp-smoke --help',
      command: tsxPath,
      args: [path.join(repoRoot, 'scripts', 'mcp-smoke.ts'), '--help'],
    },
  ]

  for (const check of helpChecks) {
    runCommand(check.label, check.command, check.args, check.options)
  }

  const impactFixtureDir = path.join(repoRoot, 'examples', 'fixtures', 'impact')
  const impactShowOutputPath = path.join(repoRoot, 'examples', 'output', 'impact-show.txt')
  const impactExportOutputPath = path.join(repoRoot, 'examples', 'output', 'impact-export.txt')
  const impactExportJsonPath = path.join(
    repoRoot,
    'examples',
    'output',
    'impact-demo-run-001-2024-01-01T00-00-00-000Z.json'
  )
  const impactFixtureJsonPath = path.join(
    repoRoot,
    'examples',
    'fixtures',
    'impact',
    '.jobforge',
    'impact',
    'impact-demo-run-001.json'
  )

  const impactShowOutput = runCommand(
    'impact show example',
    tsxPath,
    [path.join(repoRoot, 'scripts', 'jobforge-impact.ts'), 'show', '--run', 'demo-run-001'],
    { cwd: impactFixtureDir }
  )
  assertEqual(
    'impact show example',
    impactShowOutput,
    fs.readFileSync(impactShowOutputPath, 'utf-8')
  )

  const impactExportOutput = runCommand(
    'impact export example',
    tsxPath,
    [
      path.join(repoRoot, 'scripts', 'jobforge-impact.ts'),
      'export',
      '--run',
      'demo-run-001',
      '--output',
      '../../output',
    ],
    { cwd: impactFixtureDir }
  )
  assertEqual(
    'impact export example',
    impactExportOutput,
    fs.readFileSync(impactExportOutputPath, 'utf-8')
  )
  assertFileEqual('impact export JSON', impactExportJsonPath, impactFixtureJsonPath)

  console.log('✓ docs:verify passed')
}

try {
  main()
} catch (error) {
  console.error(error.message)
  process.exit(EXIT_CODES.failure)
}
