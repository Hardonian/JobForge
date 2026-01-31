"""PostgreSQL connection and job queue operations."""

import json
from collections.abc import Generator
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Any, TypedDict

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import WorkerConfig


class JobRow(TypedDict):
    """Job row from database (matches Prisma schema)."""

    id: str
    name: str
    description: str | None
    config: dict[str, Any]
    status: str
    priority: int
    maxRetries: int
    retryCount: int
    scheduledAt: datetime | None
    startedAt: datetime | None
    completedAt: datetime | None
    error: str | None
    correlationId: str | None
    createdAt: datetime
    updatedAt: datetime


class JobDatabase:
    """Database operations for job queue.

    Uses connection pooling for efficiency.
    All operations are atomic and use proper transactions.
    """

    def __init__(self, config: WorkerConfig) -> None:
        """Initialize database connection pool."""
        self.config = config
        self.pool = ConnectionPool(
            conninfo=config.database_url_str,
            min_size=2,
            max_size=config.max_concurrent_jobs + 2,
            timeout=30,
        )

    @contextmanager
    def get_connection(self) -> Generator[psycopg.Connection[dict_row], None, None]:
        """Get a connection from the pool."""
        with self.pool.connection() as conn:
            conn.row_factory = dict_row
            yield conn

    def claim_next_job(self, worker_id: str) -> JobRow | None:
        """Atomically claim the next available job.

        Uses SELECT FOR UPDATE SKIP LOCKED for distributed claiming.
        Only claims jobs that are:
        - status = 'pending'
        - scheduledAt is null or in the past
        - retryCount < maxRetries

        Returns None if no jobs available.
        """
        now = datetime.now(UTC)

        with self.get_connection() as conn, conn.cursor() as cur:
            # Atomically claim next job
            cur.execute(
                """
                    UPDATE jobs
                    SET
                        status = 'running',
                        "startedAt" = %s,
                        "updatedAt" = %s
                    WHERE id = (
                        SELECT id
                        FROM jobs
                        WHERE status = 'pending'
                          AND ("scheduledAt" IS NULL OR "scheduledAt" <= %s)
                          AND "retryCount" < "maxRetries"
                        ORDER BY priority DESC, "scheduledAt" ASC NULLS FIRST, "createdAt" ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING *
                    """,
                (now, now, now),
            )
            result = cur.fetchone()
            conn.commit()

            if result:
                # Parse JSONB config field
                result["config"] = (
                    json.loads(result["config"])
                    if isinstance(result["config"], str)
                    else result["config"]
                )
                return result  # type: ignore[return-value]
            return None

    def mark_job_completed(self, job_id: str, correlation_id: str | None = None) -> None:
        """Mark job as successfully completed."""
        now = datetime.now(UTC)

        with self.get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                    UPDATE jobs
                    SET
                        status = 'completed',
                        "completedAt" = %s,
                        "updatedAt" = %s,
                        "correlationId" = COALESCE(%s, "correlationId")
                    WHERE id = %s
                    """,
                (now, now, correlation_id, job_id),
            )
            conn.commit()

    def mark_job_failed(
        self, job_id: str, error: str, retry: bool = True, correlation_id: str | None = None
    ) -> None:
        """Mark job as failed.

        If retry=True and retries remaining, sets status back to 'pending'.
        Otherwise marks as 'failed'.
        """
        now = datetime.now(UTC)

        with self.get_connection() as conn, conn.cursor() as cur:
            if retry:
                # Increment retry count and reset to pending if retries remain
                cur.execute(
                    """
                        UPDATE jobs
                        SET
                            status = CASE
                                WHEN "retryCount" + 1 < "maxRetries" THEN 'pending'
                                ELSE 'failed'
                            END,
                            "retryCount" = "retryCount" + 1,
                            error = %s,
                            "completedAt" = CASE
                                WHEN "retryCount" + 1 >= "maxRetries" THEN %s
                                ELSE NULL
                            END,
                            "startedAt" = NULL,
                            "updatedAt" = %s,
                            "correlationId" = COALESCE(%s, "correlationId")
                        WHERE id = %s
                        """,
                    (error, now, now, correlation_id, job_id),
                )
            else:
                # Mark as permanently failed
                cur.execute(
                    """
                        UPDATE jobs
                        SET
                            status = 'failed',
                            error = %s,
                            "completedAt" = %s,
                            "updatedAt" = %s,
                            "correlationId" = COALESCE(%s, "correlationId")
                        WHERE id = %s
                        """,
                    (error, now, now, correlation_id, job_id),
                )
            conn.commit()

    def record_execution(
        self,
        job_id: str,
        status: str,
        worker_id: str,
        duration_ms: int | None = None,
        error: str | None = None,
        logs: str | None = None,
        correlation_id: str | None = None,
    ) -> str:
        """Record a job execution in job_executions table.

        Returns the execution ID.
        """
        now = datetime.now(UTC)

        with self.get_connection() as conn, conn.cursor() as cur:
            cur.execute(
                """
                    INSERT INTO job_executions (
                        "jobId", status, "startedAt", "completedAt",
                        duration, error, logs, "correlationId", "workerId"
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id
                    """,
                (
                    job_id,
                    status,
                    now,
                    now if status in ("completed", "failed") else None,
                    duration_ms,
                    error,
                    logs,
                    correlation_id,
                    worker_id,
                ),
            )
            result = cur.fetchone()
            conn.commit()
            return result["id"]  # type: ignore[return-value]

    def health_check(self) -> bool:
        """Check database connectivity."""
        try:
            with self.get_connection() as conn, conn.cursor() as cur:
                cur.execute("SELECT 1")
                return True
        except Exception:
            return False

    def close(self) -> None:
        """Close connection pool gracefully."""
        self.pool.close()
