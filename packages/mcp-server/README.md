# @jobforge/mcp-server

MCP Server for JobForge - exposes the execution plane and ReadyLayer governance via the Model Context Protocol (stdio transport).

## Features

- **JobForge Execution Plane Tools**: Create, run, monitor, and cancel jobs
- **Connector Tools**: List, test, and get capabilities of connectors
- **Artifact Tools**: List, get, and register artifacts
- **ReadyLayer Governance Tools**: Verify packs, repository discovery, policy checks
- **Security**: Tenant isolation, scope-based access control, rate limiting, audit logging
- **Feature Flags**: All functionality gated by environment variables (default: OFF)

## Installation

```bash
pnpm install
pnpm build
```

## Running the Server

### Development Mode (Local)

```bash
# All features disabled by default - safe to run
pnpm mcp:dev

# Enable MCP with dev mode (no auth required)
MCP_ENABLED=1 MCP_DEV_MODE=1 pnpm mcp:dev

# Enable with specific features
MCP_ENABLED=1 \
MCP_WRITE_ENABLED=1 \
MCP_READYLAYER_ENABLED=1 \
MCP_DEV_MODE=1 \
MCP_DEFAULT_TENANT_ID=00000000-0000-0000-0000-000000000000 \
pnpm mcp:dev
```

### Production

```bash
MCP_ENABLED=1 \
MCP_AUDIT_ENABLED=1 \
MCP_POLICY_TOKEN_SECRET=<your-secret> \
MCP_REQUIRE_POLICY_TOKENS=1 \
node dist/server.js
```

## Environment Variables

| Variable                    | Default | Description                                     |
| --------------------------- | ------- | ----------------------------------------------- |
| `MCP_ENABLED`               | `0`     | Master switch to enable MCP server              |
| `MCP_WRITE_ENABLED`         | `0`     | Enable write operations (create, run, cancel)   |
| `MCP_PR_ENABLED`            | `0`     | Enable PR operations (apply_patchset, open)     |
| `MCP_READYLAYER_ENABLED`    | `0`     | Enable ReadyLayer governance tools              |
| `MCP_AUDIT_ENABLED`         | `1`     | Enable audit logging (default: ON for security) |
| `MCP_DEV_MODE`              | `0`     | Dev mode (allows unauthenticated access)        |
| `MCP_POLICY_TOKEN_SECRET`   | ``      | Secret for signing policy tokens                |
| `MCP_REQUIRE_POLICY_TOKENS` | `1`     | Require policy tokens for write operations      |
| `MCP_DEFAULT_TENANT_ID`     | ``      | Default tenant ID for dev mode                  |

## Available Tools

### JobForge Execution Plane

- `jobforge.jobs.create` - Create a new job (scopes: `jobs:run`)
- `jobforge.jobs.run` - Create and optionally wait for job completion (scopes: `jobs:run`)
- `jobforge.jobs.status` - Get job run status (scopes: `jobs:read`)
- `jobforge.jobs.logs` - Get job logs (scopes: `jobs:read`)
- `jobforge.jobs.cancel` - Cancel a running job (scopes: `jobs:write`)

### Connectors

- `jobforge.connectors.list` - List connectors (scopes: `connectors:read`)
- `jobforge.connectors.test` - Test a connector (scopes: `connectors:test`)
- `jobforge.connectors.capabilities` - Get connector capabilities (scopes: `connectors:read`)

### Artifacts

- `jobforge.artifacts.list` - List artifacts (scopes: `artifacts:read`)
- `jobforge.artifacts.get` - Get artifact (scopes: `artifacts:read`)
- `jobforge.artifacts.put` - Register artifact (scopes: `artifacts:write`)

### ReadyLayer Governance

- `readylayer.quality.verify` - Run verification pack via JobForge (scopes: `readylayer:verify`)
- `readylayer.repo.discover` - Discover repository structure (scopes: `readylayer:read`)
- `readylayer.policy.check_diff` - Check policy compliance (scopes: `readylayer:read`)
- `readylayer.security.deps_audit` - Audit dependencies (scopes: `readylayer:read`)
- `readylayer.pr.propose_patchset` - Propose changes (scopes: `readylayer:write`, read-only)
- `readylayer.pr.apply_patchset` - Apply changes (scopes: `readylayer:write`, requires policy token)
- `readylayer.pr.open` - Open PR (scopes: `readylayer:write`, requires policy token)

## Policy Tokens

For write operations, you can generate policy tokens:

```typescript
import { generatePolicyToken } from '@jobforge/mcp-server'

const token = generatePolicyToken('actor-123', 'tenant-uuid', ['jobs:run', 'jobs:write'], {
  expiresInHours: 1,
})
```

## Testing

### Smoke Test

```bash
pnpm test

# Or run manually
MCP_ENABLED=1 MCP_DEV_MODE=1 node dist/server.js
```

### Using with Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jobforge": {
      "command": "node",
      "args": ["/path/to/jobforge/packages/mcp-server/dist/server.js"],
      "env": {
        "MCP_ENABLED": "1",
        "MCP_DEV_MODE": "1",
        "MCP_WRITE_ENABLED": "1",
        "MCP_READYLAYER_ENABLED": "1"
      }
    }
  }
}
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     MCP Client (Claude)                      │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ stdio
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                  @jobforge/mcp-server                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Auth Resolver│  │ Tool Registry│  │  Rate Limit  │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Scope Check  │  │  Audit Log   │  │ Feature Flags│       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ @jobforge/   │   │ @jobforge/   │   │ @jobforge/   │
│ client       │   │ shared       │   │ observability│
└──────────────┘   └──────────────┘   └──────────────┘
```

## License

MIT
