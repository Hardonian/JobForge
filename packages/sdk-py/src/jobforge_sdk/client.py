"""JobForge Python SDK client."""

import asyncio
import time
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx

from .models import (
    BatchEnqueueJobParams,
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
    JobForge Python SDK synchronous client.

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
        Enqueue a new job with priority and timeout support.
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
                "p_priority": params.priority,
                "p_timeout_ms": params.timeout_ms,
            },
        )
        return JobRow.model_validate(data)

    def enqueue_batch(self, params: BatchEnqueueJobParams) -> list[JobRow]:
        """
        Enqueue multiple jobs in a single atomic transaction.
        """
        jobs_payload = [
            {
                "type": j.type,
                "payload": j.payload,
                "idempotency_key": j.idempotency_key,
                "run_at": j.run_at.isoformat() if j.run_at else datetime.utcnow().isoformat(),
                "max_attempts": j.max_attempts,
                "priority": j.priority,
                "timeout_ms": j.timeout_ms,
            }
            for j in params.jobs
        ]

        data = self._rpc(
            "jobforge_enqueue_batch",
            {
                "p_tenant_id": str(params.tenant_id),
                "p_jobs": jobs_payload,
            },
        )
        return [JobRow.model_validate(job) for job in (data or [])]

    def claim_jobs(self, params: ClaimJobsParams) -> list[JobRow]:
        """
        Claim jobs for processing (worker use).
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

    def wait_for_job(
        self,
        job_id: UUID,
        tenant_id: UUID,
        poll_interval: float = 0.5,
        timeout: float = 60.0,
    ) -> JobRow:
        """
        Polls until the job reaches a terminal state (succeeded, failed, dead, canceled).
        """
        start = time.time()
        while time.time() - start < timeout:
            job = self.get_job(job_id, tenant_id)
            if not job:
                raise JobForgeError(f"Job not found: {job_id}")

            if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.DEAD, JobStatus.CANCELED):
                return job

            time.sleep(poll_interval)

        raise TimeoutError(f"Job {job_id} did not reach terminal state within {timeout}s")

    def get_result(self, result_id: UUID, tenant_id: UUID) -> JobResultRow | None:
        """
        Get job result.
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


class AsyncJobForgeClient:
    """
    JobForge Python SDK asynchronous client.
    """

    def __init__(
        self,
        supabase_url: str,
        supabase_key: str,
        *,
        timeout: float = 30.0,
    ) -> None:
        self.supabase_url = supabase_url.rstrip("/")
        self.supabase_key = supabase_key
        self.timeout = timeout
        self._client = httpx.AsyncClient(
            base_url=f"{self.supabase_url}/rest/v1",
            headers={
                "apikey": supabase_key,
                "Authorization": f"Bearer {supabase_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    async def __aenter__(self) -> "AsyncJobForgeClient":
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._client.aclose()

    async def _rpc(self, function: str, params: dict[str, Any]) -> Any:
        response = await self._client.post(f"/rpc/{function}", json=params)
        if response.status_code >= 400:
            raise JobForgeError(
                f"Async RPC call failed: {response.status_code} {response.text}"
            )
        return response.json()

    async def enqueue_job(self, params: EnqueueJobParams) -> JobRow:
        data = await self._rpc(
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
                "p_priority": params.priority,
                "p_timeout_ms": params.timeout_ms,
            },
        )
        return JobRow.model_validate(data)

    async def enqueue_batch(self, params: BatchEnqueueJobParams) -> list[JobRow]:
        jobs_payload = [
            {
                "type": j.type,
                "payload": j.payload,
                "idempotency_key": j.idempotency_key,
                "run_at": j.run_at.isoformat() if j.run_at else datetime.utcnow().isoformat(),
                "max_attempts": j.max_attempts,
                "priority": j.priority,
                "timeout_ms": j.timeout_ms,
            }
            for j in params.jobs
        ]

        data = await self._rpc(
            "jobforge_enqueue_batch",
            {
                "p_tenant_id": str(params.tenant_id),
                "p_jobs": jobs_payload,
            },
        )
        return [JobRow.model_validate(job) for job in (data or [])]

    async def claim_jobs(self, params: ClaimJobsParams) -> list[JobRow]:
        data = await self._rpc(
            "jobforge_claim_jobs",
            {
                "p_worker_id": params.worker_id,
                "p_limit": params.limit,
            },
        )
        return [JobRow.model_validate(job) for job in (data or [])]

    async def heartbeat_job(self, params: HeartbeatJobParams) -> None:
        await self._rpc(
            "jobforge_heartbeat_job",
            {
                "p_job_id": str(params.job_id),
                "p_worker_id": params.worker_id,
            },
        )

    async def complete_job(self, params: CompleteJobParams) -> None:
        await self._rpc(
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

    async def get_job(self, job_id: UUID, tenant_id: UUID) -> JobRow | None:
        response = await self._client.get(
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

    async def wait_for_job(
        self,
        job_id: UUID,
        tenant_id: UUID,
        poll_interval: float = 0.5,
        timeout: float = 60.0,
    ) -> JobRow:
        start = time.time()
        while time.time() - start < timeout:
            job = await self.get_job(job_id, tenant_id)
            if not job:
                raise JobForgeError(f"Job not found: {job_id}")

            if job.status in (JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.DEAD, JobStatus.CANCELED):
                return job

            await asyncio.sleep(poll_interval)

        raise TimeoutError(f"Job {job_id} did not reach terminal state within {timeout}s")
