"""RPC client for write operations to JobForge API."""

from typing import Any

import httpx

from .config import WorkerConfig
from .errors import JobRPCError, get_current_correlation_id


class RPCClient:
    """HTTP client for RPC-based writes to JobForge API.

    All state mutations must go through the API, not direct database writes.
    This ensures consistency, validation, and proper audit trails.
    """

    def __init__(self, config: WorkerConfig) -> None:
        """Initialize RPC client."""
        self.config = config
        self.base_url = config.api_base_url.rstrip("/")
        self.timeout = config.rpc_timeout_seconds

        self.client = httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            headers={
                "User-Agent": f"jobforge-worker/{config.worker_id}",
            },
        )

    def _get_headers(self) -> dict[str, str]:
        """Get headers with correlation ID if available."""
        headers: dict[str, str] = {}
        correlation_id = get_current_correlation_id()
        if correlation_id:
            headers["X-Correlation-ID"] = correlation_id
        return headers

    def create_job(
        self,
        name: str,
        config: dict[str, Any],
        priority: int = 0,
        max_retries: int = 3,
    ) -> str:
        """Create a new job via API.

        Returns the job ID.
        """
        try:
            response = self.client.post(
                "/api/jobs",
                json={
                    "name": name,
                    "config": config,
                    "priority": priority,
                    "maxRetries": max_retries,
                },
                headers=self._get_headers(),
            )
            response.raise_for_status()
            data = response.json()
            return data["id"]  # type: ignore[return-value]
        except httpx.HTTPStatusError as e:
            raise JobRPCError(
                f"Failed to create job: {e.response.text}", e.response.status_code
            ) from e
        except httpx.RequestError as e:
            raise JobRPCError(f"RPC request failed: {str(e)}") from e

    def update_job_status(
        self,
        job_id: str,
        status: str,
        error: str | None = None,
    ) -> None:
        """Update job status via API."""
        try:
            response = self.client.patch(
                f"/api/jobs/{job_id}",
                json={"status": status, "error": error},
                headers=self._get_headers(),
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            raise JobRPCError(
                f"Failed to update job status: {e.response.text}",
                e.response.status_code,
            ) from e
        except httpx.RequestError as e:
            raise JobRPCError(f"RPC request failed: {str(e)}") from e

    def health_check(self) -> bool:
        """Check API health."""
        try:
            response = self.client.get("/api/health", timeout=5)
            return response.status_code == 200
        except Exception:
            return False

    def close(self) -> None:
        """Close HTTP client."""
        self.client.close()
