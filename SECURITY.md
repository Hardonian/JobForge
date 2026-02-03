# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability within JobForge, please report it responsibly.

### How to Report

1. **Do NOT** open a public GitHub issue
2. Email security concerns to: [TBD - Add security contact]
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Initial assessment**: Within 5 business days
- **Resolution**: Based on severity
  - Critical: 7 days
  - High: 30 days
  - Medium: 90 days
  - Low: Next release

## Security Model

### Tenant Isolation

JobForge uses PostgreSQL Row Level Security (RLS) for strict tenant isolation:

- All tables have RLS enabled
- RPC functions enforce tenant context via `app.tenant_id` setting
- No direct table mutations allowed (RPC-only)

### Authentication

- Supabase Auth integration
- JWT-based session management
- Service role key for worker authentication

### Input Validation

- Zod schemas for all API inputs
- SSRF protection for HTTP connectors
- Payload size limits (1MB default)

### Secrets Management

- No secrets in repository
- Environment-based configuration
- Encrypted at rest in Supabase

## Best Practices

1. **Never commit secrets** - Use `.env.local` files
2. **Validate all inputs** - Use provided Zod schemas
3. **Use RPC functions** - Don't bypass RLS with service keys
4. **Enable audit logging** - Track all job executions
5. **Monitor worker health** - Use heartbeat tracking

## Known Security Considerations

### Rate Limiting

The current implementation does not include built-in rate limiting. For production use:

- Implement rate limiting at the API Gateway/Reverse Proxy level
- Monitor job queue depth and worker capacity
- Consider implementing per-tenant job quotas

### Connector Security

HTTP connectors include basic SSRF protection:

- Private IP ranges are blocked
- URL validation is enforced
- Timeout limits prevent long-running requests

For additional security:

- Implement allowlist/blocklist for URL patterns
- Add request signing for webhook verification
- Use mTLS for internal service communication

## Security Checklist

Before deploying to production:

- [ ] Enable RLS on all tables
- [ ] Configure proper tenant isolation
- [ ] Set up secrets management (not in env files)
- [ ] Enable audit logging
- [ ] Configure backup retention
- [ ] Set up monitoring and alerting
- [ ] Review connector configurations
- [ ] Test failure scenarios
- [ ] Document incident response procedures
