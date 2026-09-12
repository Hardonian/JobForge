"""JobForge Universal Direct PostgreSQL Client.

Enables pure SQL wire-protocol communication with PostgreSQL databases
(AWS RDS, Aurora, Cloud SQL, Azure, Neon, Docker Compose, or Bare Metal)
without requiring Supabase PostgREST.
"""

from __future__ import annotations

import base64
import gzip
import json
from typing import Any, Callable, Sequence
from uuid import UUID

from .models import (
    ClaimJobsParams,
    CompleteJobParams,
    EnqueueJobParams,
    HeartbeatJobParams,
    JobRow,
    JobStatus,
)


def _compress_payload(payload: dict[str, Any], threshold_bytes: int = 2048) -> dict[str, Any]:
    """Compress payload if JSON size exceeds threshold."""
    if not payload:
        return payload

    if payload.get("__compressed") is True:
        return payload

    json_bytes = json.dumps(payload).encode("utf-8")
    if len(json_bytes) <= threshold_bytes:
        return payload

    compressed = gzip.compress(json_bytes)
    return {
        "__compressed": True,
        "__alg": "gzip",
        "__original_size_bytes": len(json_bytes),
        "__compressed_size_bytes": len(compressed),
        "__data": base64.b64encode(compressed).decode("ascii"),
    }


def _decompress_payload(payload: Any) -> Any:
    """Transparently decompress payload if wrapped in compression envelope."""
    if (
        isinstance(payload, dict)
        and payload.get("__compressed") is True
        and payload.get("__alg") == "gzip"
    ):
        data_b64 = payload.get("__data")
        if isinstance(data_b64, str):
            try:
                raw_bytes = gzip.decompress(base64.b64decode(data_b64))
                return json.loads(raw_bytes.decode("utf-8"))
            except Exception:
                return payload
    return payload


class DirectPgJobForgeClient:
    """Universal direct PostgreSQL client executing raw parameterized SQL."""

    def __init__(self, query_executor: Callable[[str, Sequence[Any] | None], Sequence[dict[str, Any]]]) -> None:
        """
        Initialize client with a pluggable query executor callable.

        The executor signature: `executor(sql: str, params: Sequence[Any] | None) -> Sequence[dict[str, Any]]`.
        Compatible with psycopg3, asyncpg adapters, sqlite3, or custom connection poolers.
        """
        self._executor = query_executor

    def enqueue_job(self, params: EnqueueJobParams) -> JobRow:
        """Enqueue job directly with transparent compression."""
        compressed_payload = _compress_payload(params.payload)

        sql = """
            INSERT INTO jobforge_jobs (
                tenant_id, type, payload, priority, timeout_ms, idempotency_key, run_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, COALESCE(%s, NOW()))
            ON CONFLICT (tenant_id, type, idempotency_key) WHERE idempotency_key IS NOT NULL
            DO UPDATE SET updated_at = NOW()
            RETURNING *;
        """

        rows = self._executor(
            sql,
            (
                str(params.tenant_id),
                params.type,
                json.dumps(compressed_payload),
                params.priority or 0,
                params.timeout_ms or 300000,
                params.idempotency_key,
                params.run_at,
            ),
        )

        if not rows:
            raise RuntimeError("Database did not return created row on enqueue")

        row_dict = dict(rows[0])
        row_dict["payload"] = _decompress_payload(row_dict.get("payload", {}))
        return JobRow.model_validate(row_dict)

    def claim_jobs(self, params: ClaimJobsParams) -> list[JobRow]:
        """Claim jobs using claim_jobs_with_priority RPC."""
        sql = "SELECT * FROM claim_jobs_with_priority(%s, %s);"
        rows = self._executor(sql, (params.worker_id, params.limit or 10))

        results: list[JobRow] = []
        for r in rows:
            row_dict = dict(r)
            row_dict["payload"] = _decompress_payload(row_dict.get("payload", {}))
            results.append(JobRow.model_validate(row_dict))
        return results

    def claim_jobs_fair_share(
        self, worker_id: str, limit: int = 10, tenant_limit: int = 2
    ) -> list[JobRow]:
        """Claim jobs using claim_jobs_fair_share RPC."""
        sql = "SELECT * FROM claim_jobs_fair_share(%s, %s, %s);"
        rows = self._executor(sql, (worker_id, limit, tenant_limit))

        results: list[JobRow] = []
        for r in rows:
            row_dict = dict(r)
            row_dict["payload"] = _decompress_payload(row_dict.get("payload", {}))
            results.append(JobRow.model_validate(row_dict))
        return results

    def complete_job(self, params: CompleteJobParams) -> None:
        """Complete a job using complete_job RPC."""
        sql = "SELECT complete_job(%s, %s, %s, %s, %s);"
        result_json = json.dumps(params.result) if params.result else None
        error_json = json.dumps(params.error) if params.error else None

        self._executor(
            sql,
            (
                str(params.job_id),
                params.worker_id,
                params.status.value if hasattr(params.status, "value") else str(params.status),
                result_json,
                error_json,
            ),
        )

    def heartbeat_job(self, params: HeartbeatJobParams) -> None:
        """Record worker heartbeat."""
        sql = """
            UPDATE jobforge_jobs
            SET heartbeat_at = NOW(), updated_at = NOW()
            WHERE id = %s AND locked_by = %s AND status = 'running';
        """
        self._executor(sql, (str(params.job_id), params.worker_id))

    def get_tenant_billing_metrics(
        self, tenant_id: str | UUID, start_date: str | None = None, end_date: str | None = None
    ) -> list[dict[str, Any]]:
        """Retrieve FinOps billing metrics for tenant."""
        sql = "SELECT * FROM get_tenant_billing_metrics(%s, COALESCE(%s, CURRENT_DATE - INTERVAL '30 days'), COALESCE(%s, CURRENT_DATE));"
        rows = self._executor(sql, (str(tenant_id), start_date, end_date))
        return [dict(r) for r in rows]
