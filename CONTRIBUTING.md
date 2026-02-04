# Contributing to JobForge

Thanks for helping improve JobForge. This guide focuses on safe, verifiable changes and a smooth first contribution path.

## Who Should Contribute

- Contributors familiar with Postgres/Supabase job processing
- SDK and worker developers
- Docs authors and tooling maintainers

## First-Time Contributor Path

1. Read the project overview in [README.md](README.md).
2. Scan `docs/ARCHITECTURE.md` and `supabase/README.md` to understand the database contract.
3. Pick a small change:
   - Docs fixes or examples
   - Small handler improvements
   - Refactors limited to a single package
4. Look for issues labeled **good first issue** or **docs**.

## Development Setup

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm 8+
- Postgres or Supabase (for end-to-end testing)

### Install

```bash
pnpm install
```

### Common commands

```bash
# Run dev servers (monorepo)
pnpm dev

# Fast verification (format + lint + typecheck)
pnpm run verify:fast

# Full verification (lint + typecheck + test + build + docs verify)
pnpm run verify
```

## Quality Gates (Required)

- `pnpm run verify:fast` for local changes
- `pnpm run verify` before opening a PR

CI enforces:

- Formatting, linting, type checks
- Tests and build
- Docs reality checks (`scripts/docs-verify.js`)
- Security gates (secret scan + dependency audit)

## Project Boundaries

Please avoid changes that:

- Modify the database contract without updating migrations and docs
- Bypass RPC functions or RLS policies
- Introduce new runtime dependencies without justification

## Extension Points

- **Job handlers**: add new handlers under `services/worker-ts/src/handlers` (or the Python worker).
- **Schemas**: keep shared types and validation in `packages/shared/src`.
- **CLI tooling**: add scripts in `scripts/` and document them in `docs/cli.md` if user-facing.

## Documentation Guidelines

- Keep README and docs in sync with code.
- If you add a command to README, update `scripts/docs-verify.js` so CI can validate it.
- No placeholder text or broken links.

## Commit Guidelines

- Write clear, descriptive commit messages.
- Keep changes focused and reviewable.

## Discussions & Questions

- **Questions**: GitHub Discussions → Q&A category
- **Ideas/Proposals**: GitHub Discussions → Ideas category
- **Show & tell**: GitHub Discussions → Show and tell category
- **Design/Architecture**: GitHub Discussions → Design category
- **Bugs/Tasks**: GitHub Issues

If you are unsure, start a Discussion before investing in large changes.
