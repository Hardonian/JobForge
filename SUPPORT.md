# Support

## Getting Help

### Documentation

- [README](README.md) - Quick start and overview
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design and patterns
- [RUNBOOK.md](docs/RUNBOOK.md) - Operations and troubleshooting
- [SECURITY.md](SECURITY.md) - Security model and reporting

### Community Support

- **GitHub Discussions**: Q&A, ideas, show & tell, and design discussions
- **GitHub Issues**: Bug reports and feature requests

### Commercial Support

Commercial support is not currently offered through this repository. If that changes it will be announced in README and Discussions.

## Reporting Issues

### Bug Reports

When reporting bugs, please include:

1. **Environment details**:
   - Node.js version
   - pnpm version
   - PostgreSQL/Supabase version
   - Operating system

2. **Steps to reproduce**:
   - Minimal code example
   - Expected behavior
   - Actual behavior

3. **Logs and errors**:
   - Full error messages
   - Stack traces
   - Worker logs (if applicable)

4. **Configuration** (sanitized):
   - Relevant environment variables (without secrets)
   - Package versions from `package.json`

### Feature Requests

We welcome feature requests! Please:

1. Check existing issues first
2. Describe the use case
3. Explain the proposed solution
4. Consider backward compatibility

## Troubleshooting

### Common Issues

#### Worker not claiming jobs

- Check worker logs for connection errors
- Verify Supabase credentials
- Ensure RLS policies allow worker access
- Check for blocked queue (dead jobs)

#### Jobs failing immediately

- Review job payload validation
- Check connector configurations
- Verify handler registrations
- Review error logs in `jobforge_job_attempts`

#### Database connection errors

- Verify connection string
- Check firewall rules
- Ensure SSL/TLS configuration
- Review Supabase dashboard for outages

#### Type errors after upgrade

- Run `pnpm install` to update dependencies
- Check for breaking changes in CHANGELOG
- Clear TypeScript cache: `rm -rf node_modules .turbo **/tsconfig.tsbuildinfo`

## Development Support

### Setting up Development Environment

```bash
# Install dependencies
pnpm install

# Set up environment
cp .env.example .env.local
# Edit .env.local with your values

# Run tests
pnpm run test

# Build all packages
pnpm run build
```

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Getting Started with Development

New contributors should:

1. Read the [Architecture Guide](docs/ARCHITECTURE.md)
2. Review [existing tests](packages/shared/test/) for patterns
3. Start with issues labeled **good first issue** or **docs**

## Security Issues

For security-related issues, see [SECURITY.md](SECURITY.md).

## Communication Channels

- **Async**: GitHub Discussions (preferred)
- **Issues**: GitHub Issues for tracked work

Response times:

- Security issues: 48 hours
- Critical bugs: 5 business days
- General questions: 10 business days

## Feedback

We value your feedback! Please share:

- What works well
- What could be improved
- Missing features you'd like to see
- Documentation gaps

## Resources

- [CLI Reference](docs/cli.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Runbook](docs/RUNBOOK.md)
- [Security Model](docs/SECURITY.md)
