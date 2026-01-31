# JobForge Python Worker

Minimal, production-hardened Python worker framework for JobForge job orchestration.

## Features

- ✅ **Idempotent handlers** - Safe to retry, safe to run multiple times
- ✅ **Postgres-native queue** - No Redis, no Kafka, just Postgres
- ✅ **Strict environment validation** - Fails fast on invalid config
- ✅ **RPC-based writes** - All mutations go through API for consistency
- ✅ **Distributed locking** - Multiple workers, no race conditions
- ✅ **Correlation ID tracking** - End-to-end request tracing
- ✅ **Automatic retries** - Configurable retry policy with backoff
- ✅ **Graceful shutdown** - SIGTERM/SIGINT handling
- ✅ **Type-safe** - Full type hints with mypy strict mode

## Installation

```bash
cd packages/python-worker
pip install -r requirements.txt
```

For development:

```bash
pip install -r requirements-dev.txt
```

## Quick Start

### 1. Configure Environment

Copy the example environment file:

```bash
cp examples/.env.example .env
```

Edit `.env` with your configuration:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/jobforge
WORKER_ID=worker-python-01
API_BASE_URL=http://localhost:3000
```

### 2. Create a Worker

```python
from jobforge_worker import Worker, WorkerConfig, JobHandler
from jobforge_worker.database import JobRow
from jobforge_worker.rpc import RPCClient

# Define your job handler (must be idempotent!)
class ProcessOrderHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        order_id = job["config"]["order_id"]

        # Use order_id as idempotency key in external systems
        # This handler can be safely retried
        print(f"Processing order {order_id}")

        # Do work...

        # Optionally trigger follow-up jobs via RPC
        # rpc.create_job("send_email", {"order_id": order_id})

# Initialize worker
config = WorkerConfig()
worker = Worker(config)

# Register handlers
worker.register_handler("process_order", ProcessOrderHandler())

# Run (blocks until shutdown)
worker.run()
```

### 3. Run the Worker

```bash
python your_worker.py
```

## Job Handler Best Practices

### Idempotency is Critical

Handlers MUST be idempotent - safe to run multiple times with same input:

```python
class GoodHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        # ✅ Use job ID as idempotency key
        idempotency_key = job["id"]

        # ✅ Check if already processed
        if already_processed(idempotency_key):
            return

        # ✅ Use external system's idempotency features
        stripe.Charge.create(
            amount=1000,
            currency="usd",
            idempotency_key=idempotency_key,
        )
```

Bad example:

```python
class BadHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        # ❌ NOT idempotent - creates duplicate charges on retry!
        stripe.Charge.create(amount=1000, currency="usd")
```

### Configuration Validation

Always validate job configuration:

```python
from jobforge_worker.errors import JobValidationError

class ValidatingHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        config = job["config"]

        # Validate required fields
        user_id = config.get("user_id")
        if not user_id:
            raise JobValidationError("Missing required field: user_id")

        # Process...
```

### Use RPC for Writes

Never write directly to the database. Use RPC client:

```python
class RPCHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        # ✅ Use RPC to create follow-up jobs
        next_job_id = rpc.create_job(
            name="send_notification",
            config={"user_id": "123"},
            priority=10,
        )

        # ❌ Don't write directly to database!
        # db.execute("INSERT INTO jobs ...")  # WRONG!
```

## Error Handling

The framework provides typed exceptions:

```python
from jobforge_worker.errors import (
    JobError,           # Base - retryable by default
    JobValidationError, # Non-retryable
    JobTimeoutError,    # Retryable
    JobRPCError,        # Retryable
)

class SmartHandler(JobHandler):
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        # Non-retryable errors (bad config, invalid data)
        if not valid_config(job["config"]):
            raise JobValidationError("Invalid configuration")

        # Retryable errors (transient failures)
        try:
            external_api.call()
        except APIError as e:
            raise JobError(f"API failed: {e}", retryable=True)
```

## Configuration Reference

All configuration via environment variables:

| Variable                | Required | Default     | Description                  |
| ----------------------- | -------- | ----------- | ---------------------------- |
| `DATABASE_URL`          | Yes      | -           | PostgreSQL connection string |
| `WORKER_ID`             | Yes      | -           | Unique worker identifier     |
| `API_BASE_URL`          | Yes      | -           | JobForge API base URL        |
| `POLL_INTERVAL_SECONDS` | No       | 5           | Seconds between queue polls  |
| `MAX_CONCURRENT_JOBS`   | No       | 5           | Max concurrent jobs          |
| `JOB_TIMEOUT_SECONDS`   | No       | 300         | Job execution timeout        |
| `RPC_TIMEOUT_SECONDS`   | No       | 30          | RPC call timeout             |
| `ENVIRONMENT`           | No       | development | Runtime environment          |

## Development

### Run Tests

```bash
pytest
```

With coverage:

```bash
pytest --cov=jobforge_worker --cov-report=term-missing
```

### Type Checking

```bash
mypy src
```

### Linting

```bash
ruff check src tests
```

Auto-fix:

```bash
ruff check --fix src tests
```

### Format

```bash
ruff format src tests
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│ Worker Process                                  │
│                                                 │
│  ┌──────────────┐      ┌─────────────────┐    │
│  │ Poll Queue   │─────▶│ Claim Job       │    │
│  │ (every 5s)   │      │ (atomic UPDATE) │    │
│  └──────────────┘      └─────────────────┘    │
│                               │                 │
│                               ▼                 │
│                        ┌─────────────────┐     │
│                        │ Execute Handler │     │
│                        │ (idempotent)    │     │
│                        └─────────────────┘     │
│                               │                 │
│                    ┌──────────┴──────────┐     │
│                    ▼                     ▼     │
│            ┌──────────────┐      ┌──────────┐ │
│            │ Mark Success │      │ Mark Fail│ │
│            └──────────────┘      └──────────┘ │
│                    │                     │     │
│                    └──────────┬──────────┘     │
│                               ▼                 │
│                        ┌─────────────────┐     │
│                        │ Record Execution│     │
│                        └─────────────────┘     │
└─────────────────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │ PostgreSQL       │
              │ - jobs table     │
              │ - job_executions │
              │ - job_locks      │
              └──────────────────┘
```

## Production Checklist

- [ ] Set `ENVIRONMENT=production`
- [ ] Configure proper `DATABASE_URL` with connection pooling
- [ ] Use unique `WORKER_ID` per instance (e.g., `worker-python-{hostname}`)
- [ ] Set appropriate `JOB_TIMEOUT_SECONDS` for your workload
- [ ] Configure `MAX_CONCURRENT_JOBS` based on worker resources
- [ ] Enable structured logging (JSON format)
- [ ] Monitor job execution times and failure rates
- [ ] Set up alerting for stuck jobs
- [ ] Use process manager (systemd, supervisor, k8s)
- [ ] Configure graceful shutdown timeout (>= `JOB_TIMEOUT_SECONDS`)

## License

MIT
