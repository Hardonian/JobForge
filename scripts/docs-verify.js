const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const tsxPath = path.join(repoRoot, 'packages', 'shared', 'node_modules', '.bin', 'tsx')

const EXIT_CODES = {
  success: 0,
  failure: 1,
}

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

function main() {
  if (!fs.existsSync(tsxPath)) {
    throw new Error(`tsx binary not found at ${tsxPath}`)
  }

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
  assertEqual('impact show example', impactShowOutput, fs.readFileSync(impactShowOutputPath, 'utf-8'))

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
