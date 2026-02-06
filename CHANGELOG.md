# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- OSS documentation: SECURITY.md, CODE_OF_CONDUCT.md, SUPPORT.md, CHANGELOG.md
- Defensive Python tooling scripts (skip when ruff/mypy unavailable)
- @autopilot/contracts package with canonical schemas
- Type re-exports from @autopilot/contracts in @jobforge/shared
- Web health endpoint with rate limiting and structured logging
- E2E smoke suite hardened for dry-run execution and CI gating
- Python SDK + worker tests for webhook signing and client RPC behavior
- Deployment guide and updated reality map

### Fixed

- Prettier formatting across 92 files
- Zod v4 compatibility: z.record() API requires (key, value) pairs
- packages/contracts tsconfig path resolution
- Python lint/typecheck failures when tools unavailable
- Unused variable lint errors in observability and integration packages
- Worker lint errors and SSRF protection gaps in webhook delivery

### Changed

- Updated @jobforge/integration to depend on @autopilot/contracts
- Enhanced tsconfig.json files with explicit moduleResolution

## [0.1.0] - 2024-01-XX

### Added

- Initial release of JobForge
- PostgreSQL-native job queue with RLS
- Multi-tenant isolation
- TypeScript and Python workers
- Built-in connectors (HTTP, webhook, report)
- Autopilot job templates
- Contract testing framework
- Execution plane for runnerless modules
- Impact mapping and replay system

### Security

- SSRF protection for HTTP connectors
- Row Level Security (RLS) on all tables
- Idempotency via (tenant_id, type, idempotency_key) uniqueness
- Automatic retries with exponential backoff
- Dead letter queue for failed jobs

[Unreleased]: https://github.com/TBD/jobforge/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/TBD/jobforge/releases/tag/v0.1.0
