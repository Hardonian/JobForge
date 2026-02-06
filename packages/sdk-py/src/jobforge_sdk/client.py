"""JobForge Python SDK client."""

from datetime import datetime
from typing import Any
from uuid import UUID

import httpx

from .models import (
    CancelJobParams,
    ClaimJobsParams,
    CompleteJobParams,
    EnqueueJobParams,
    HeartbeatJobParams,
    JobResultRow,
    JobRow,
    JobStatus,
    ListJobsParams,
    RescheduleJobParams,
)


class JobForgeError(Exception):
    """Base exception for JobForge SDK."""


class JobForgeClient:
    """
    JobForge Python SDK client.

    Server-only client for interacting with JobForge via Supabase RPC.
    Never expose service keys on the client.
    """

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        """
        Initialize JobForge client.

        Args:
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key (server-only!)
            timeout: Request timeout in seconds
        """
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_key
        self.timeout = timeout
        self._client = httpx.Client(
            base_url=f"{self.supabase_url}/rest/v1",
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def __enter__(self) -> "JobForgeClient":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def close(self) -> None:
        """Close HTTP client."""
        self._client.close()

    def _rpc(self, function: str, params: dict[str, Any]) -> Any:
        """Call Supabase RPC function."""
        response = self._client.post(f"/rpc/{function}", json=params)
        if response.status_code >= 400:
            raise JobForgeError(
                f"RPC call failed: {response.status_code} {response.text}"
            )
        return response.json()

    def enqueue_job(self, params: EnqueueJobParams) -> JobRow:
        """
        Enqueue a new job.

        Args:
            params: Job parameters

        Returns:
            Created job row

        Raises:
            JobForgeError: If enqueue fails
            ValidationError: If params are invalid
        """
        data = self._rpc(
            "jobforge_enqueue_job",
            {
                "p_tenant_id": str(params.tenant_id),
                "p_type": params.type,
                "p_payload": params.payload,
                "p_idempotency_key": params.idempotency_key,
                "p_run_at": (
                    params.run_at.isoformat()
                    if params.run_at
                    else datetime.utcnow().isoformat()
                ),
                "p_max_attempts": params.max_attempts,
            },
        )
        return JobRow.model_validate(data)

    def claim_jobs(self, params: ClaimJobsParams) -> list[JobRow]:
        """
        Claim jobs for processing (worker use).

        Args:
            params: Claim parameters

        Returns:
            List of claimed jobs

        Raises:
            JobForgeError: If claim fails
        """
        data = self._rpc(
            "jobforge_claim_jobs",
            {
                "p_worker_id": params.worker_id,
                "p_limit": params.limit,
            },
        )
        return [JobRow.model_validate(job) for job in (data or [])]

    def heartbeat_job(self, params: HeartbeatJobParams) -> None:
        """
        Send heartbeat for a running job.

        Args:
            params: Heartbeat parameters

        Raises:
            JobForgeError: If heartbeat fails
        """
        self._rpc(
            "jobforge_heartbeat_job",
            {
                "p_job_id": str(params.job_id),
                "p_worker_id": params.worker_id,
            },
        )

    def complete_job(self, params: CompleteJobParams) -> None:
        """
        Complete a job (succeeded or failed).

        Args:
            params: Completion parameters

        Raises:
            JobForgeError: If completion fails
            ValidationError: If params are invalid
        """
        self._rpc(
            "jobforge_complete_job",
            {
                "p_job_id": str(params.job_id),
                "p_worker_id": params.worker_id,
                "p_status": params.status.value,
                "p_error": params.error,
                "p_result": params.result,
                "p_artifact_ref": params.artifact_ref,
            },
        )

    def cancel_job(self, params: CancelJobParams) -> None:
        """
        Cancel a job.

        Args:
            params: Cancel parameters

        Raises:
            JobForgeError: If cancel fails
        """
        self._rpc(
            "jobforge_cancel_job",
            {
                "p_job_id": str(params.job_id),
                "p_tenant_id": str(params.tenant_id),
            },
        )

    def reschedule_job(self, params: RescheduleJobParams) -> None:
        """
        Reschedule a job.

        Args:
            params: Reschedule parameters

        Raises:
            JobForgeError: If reschedule fails
        """
        self._rpc(
            "jobforge_reschedule_job",
            {
                "p_job_id": str(params.job_id),
                "p_tenant_id": str(params.tenant_id),
                "p_run_at": params.run_at.isoformat(),
            },
        )

    def list_jobs(self, params: ListJobsParams) -> list[JobRow]:
        """
        List jobs with filters.

        Args:
            params: List parameters

        Returns:
            List of jobs

        Raises:
            JobForgeError: If list fails
        """
        filters = {}
        if params.filters:
            status_value: list[str] | str | None = None
            if isinstance(params.filters.status, list):
                status_value = [status.value for status in params.filters.status]
            elif isinstance(params.filters.status, JobStatus):
                status_value = params.filters.status.value
            else:
                status_value = params.filters.status

            filters = {
                "status": status_value,
                "type": params.filters.type,
                "limit": params.filters.limit,
                "offset": params.filters.offset,
            }

        data = self._rpc(
            "jobforge_list_jobs",
            {
                "p_tenant_id": str(params.tenant_id),
                "p_filters": filters,
            },
        )
        return [JobRow.model_validate(job) for job in (data or [])]

    def get_job(self, job_id: UUID, tenant_id: UUID) -> JobRow | None:
        """
        Get a single job by ID.

        Args:
            job_id: Job UUID
            tenant_id: Tenant UUID

        Returns:
            Job row or None if not found

        Raises:
            JobForgeError: If get fails
        """
        response = self._client.get(
            "/jobforge_jobs",
            params={"id": f"eq.{job_id}", "tenant_id": f"eq.{tenant_id}"},
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise JobForgeError(f"Get job failed: {response.status_code} {response.text}")

        data = response.json()
        if not data:
            return None
        return JobRow.model_validate(data[0])

    def get_result(self, result_id: UUID, tenant_id: UUID) -> JobResultRow | None:
        """
        Get job result.

        Args:
            result_id: Result UUID
            tenant_id: Tenant UUID

        Returns:
            Result row or None if not found

        Raises:
            JobForgeError: If get fails
        """
        response = self._client.get(
            "/jobforge_job_results",
            params={"id": f"eq.{result_id}", "tenant_id": f"eq.{tenant_id}"},
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 400:
            raise JobForgeError(
                f"Get result failed: {response.status_code} {response.text}"
            )

        data = response.json()
        if not data:
            return None
        return JobResultRow.model_validate(data[0])
