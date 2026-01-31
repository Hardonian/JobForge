# Contributing to JobForge

## Development Setup

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 8+

### Getting Started

```bash
# Install dependencies
pnpm install

# Run dev server
pnpm dev

# Verify changes (required before commit)
pnpm run verify:fast
```

## Quality Gates

### Fast Verification (Required)

```bash
pnpm run verify:fast
```

This runs:

- Format check (Prettier)
- Lint (ESLint)
- Type check (TypeScript)

### Full Verification (Pre-release)

```bash
pnpm run verify:full
```

This runs verify:fast plus:

- Build all packages
- Run tests (when available)

## Code Standards

- **No regressions**: All quality gates must pass
- **No @ts-ignore**: Use with justification only (10+ char description)
- **Formatting**: Run `pnpm format` before commit
- **Small batches**: Keep PRs focused and reviewable

## Monorepo Structure

```
apps/          # Applications (Next.js web app)
packages/      # Shared packages (UI, config, utils)
internal/      # Agent notes (gitignored, never commit)
```

## OSS Hygiene

**CRITICAL:** Never commit files from `internal/` directory.

- The `internal/` directory is for agent notes, planning, and strategy
- CI will fail if internal files are tracked
- Keep all production code OSS-safe and professional
- Remove dead code, commented experiments, and unused assets

## Commit Guidelines

- Write clear, descriptive commit messages
- Reference issue numbers where applicable
- Keep commits atomic and focused
- Run `verify:fast` before committing

## Questions?

Open an issue for discussion before major changes.
