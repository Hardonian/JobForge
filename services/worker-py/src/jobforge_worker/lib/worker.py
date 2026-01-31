"""JobForge Python Worker."""

import asyncio
import os
import signal
import sys
import time
import traceback
from typing import Any
from uuid import UUID, uuid4

# Add parent directory to path to import SDK
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../../sdk-py/src"))

from jobforge_sdk import (  # type: ignore
    ClaimJobsParams,
    CompleteJobParams,
    HeartbeatJobParams,
    JobForgeClient,
    JobRow,
    JobStatus,
)

from .logger import logger
from .registry import HandlerRegistry


class Worker:
    """JobForge worker for processing jobs."""

    def __init__(
        self,
        *,
        worker_id: str,
        supabase_url: str,
        supabase_key: str,
        registry: HandlerRegistry,
        poll_interval_s: float = 2.0,
        heartbeat_interval_s: float = 30.0,
        claim_limit: int = 10,
    ) -> None:
        """
        Initialize worker.

        Args:
            worker_id: Unique worker identifier
            supabase_url: Supabase project URL
            supabase_key: Supabase service role key
            registry: Handler registry
            poll_interval_s: Polling interval in seconds
            heartbeat_interval_s: Heartbeat interval in seconds
            claim_limit: Max jobs to claim per poll
        """
        self.worker_id = worker_id
        self.registry = registry
        self.poll_interval_s = poll_interval_s
        self.heartbeat_interval_s = heartbeat_interval_s
        self.claim_limit = claim_limit

        self.client = JobForgeClient(supabase_url, supabase_key)
        self.logger = logger.child({"worker_id": worker_id})

        self.running = False
        self.shutting_down = False
        self.active_jobs: set[str] = set()
        self.heartbeat_tasks: dict[str, asyncio.Task[None]] = {}

    async def run_once(self) -> None:
        """Run worker once (claim and process available jobs)."""
        try:
            jobs = self.client.claim_jobs(
                ClaimJobsParams(worker_id=self.worker_id, limit=self.claim_limit)
            )

            if not jobs:
                self.logger.debug("No jobs claimed")
                return

            self.logger.info(f"Claimed {len(jobs)} jobs")

            # Process jobs concurrently
            await asyncio.gather(
                *[self._process_job(job) for job in jobs],
                return_exceptions=True,
            )

        except Exception as e:
            self.logger.error("Error in run_once", {"error": str(e)})

    async def run(self) -> None:
        """Run worker in loop mode."""
        self.running = True
        self.logger.info(
            "Worker started",
            {
                "poll_interval_s": self.poll_interval_s,
                "claim_limit": self.claim_limit,
            },
        )

        self._setup_signal_handlers()

        while self.running and not self.shutting_down:
            await self.run_once()

            if not self.shutting_down:
                await asyncio.sleep(self.poll_interval_s)

        await self._shutdown()

    async def _process_job(self, job: JobRow) -> None:
        """Process a single job."""
        trace_id = str(uuid4())
        job_logger = self.logger.child(
            {
                "trace_id": trace_id,
                "job_id": str(job.id),
                "job_type": job.type,
                "tenant_id": str(job.tenant_id),
                "attempt_no": job.attempts,
            }
        )

        job_id = str(job.id)
        self.active_jobs.add(job_id)
        job_logger.info("Processing job started")

        # Start heartbeat task
        heartbeat_task = asyncio.create_task(self._heartbeat_loop(job_id, job_logger))
        self.heartbeat_tasks[job_id] = heartbeat_task

        try:
            registration = self.registry.get(job.type)

            if not registration:
                raise ValueError(f"No handler registered for job type: {job.type}")

            # Validate payload if validator provided
            if registration.validate and not registration.validate(job.payload):
                raise ValueError("Payload validation failed")

            # Create job context
            context = {
                "job_id": str(job.id),
                "tenant_id": str(job.tenant_id),
                "attempt_no": job.attempts,
                "trace_id": trace_id,
            }

            # Execute handler with timeout
            result = await asyncio.wait_for(
                asyncio.to_thread(registration.handler, job.payload, context),
                timeout=registration.timeout_s,
            )

            # Complete job successfully
            self.client.complete_job(
                CompleteJobParams(
                    job_id=UUID(job_id),
                    worker_id=self.worker_id,
                    status=JobStatus.SUCCEEDED,
                    result=result if isinstance(result, dict) else {"value": result},
                )
            )

            job_logger.info("Job succeeded")

        except asyncio.TimeoutError:
            job_logger.error("Job timeout")
            self._complete_job_failed(
                job_id, {"error": "Handler timeout", "timeout_s": registration.timeout_s}
            )

        except Exception as e:
            error_data = {
                "error": str(e),
                "type": type(e).__name__,
                "traceback": traceback.format_exc(),
            }
            job_logger.error("Job failed", {"error": str(e)})
            self._complete_job_failed(job_id, error_data)

        finally:
            # Cancel heartbeat task
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            self.heartbeat_tasks.pop(job_id, None)
            self.active_jobs.discard(job_id)

    def _complete_job_failed(self, job_id: str, error: dict[str, Any]) -> None:
        """Complete job as failed."""
        try:
            self.client.complete_job(
                CompleteJobParams(
                    job_id=UUID(job_id),
                    worker_id=self.worker_id,
                    status=JobStatus.FAILED,
                    error=error,
                )
            )
        except Exception as e:
            self.logger.error("Failed to mark job as failed", {"error": str(e)})

    async def _heartbeat_loop(self, job_id: str, job_logger: Any) -> None:
        """Send periodic heartbeats for a job."""
        try:
            while True:
                await asyncio.sleep(self.heartbeat_interval_s)
                try:
                    self.client.heartbeat_job(
                        HeartbeatJobParams(job_id=UUID(job_id), worker_id=self.worker_id)
                    )
                except Exception as e:
                    job_logger.warn("Heartbeat failed", {"error": str(e)})
        except asyncio.CancelledError:
            pass

    async def _shutdown(self) -> None:
        """Graceful shutdown."""
        self.logger.info("Worker shutting down gracefully", {"active_jobs": len(self.active_jobs)})

        # Wait for active jobs to complete (with timeout)
        shutdown_timeout_s = 30
        start = time.time()

        while self.active_jobs and (time.time() - start < shutdown_timeout_s):
            await asyncio.sleep(1)

        # Cancel remaining heartbeat tasks
        for task in self.heartbeat_tasks.values():
            task.cancel()

        self.client.close()
        self.logger.info("Worker stopped", {"remaining_jobs": len(self.active_jobs)})

    def _setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""

        def handle_signal(sig: int, frame: Any) -> None:
            if not self.shutting_down:
                sig_name = signal.Signals(sig).name
                self.logger.info(f"Received {sig_name}, shutting down...")
                self.shutting_down = True
                self.running = False

        signal.signal(signal.SIGINT, handle_signal)
        signal.signal(signal.SIGTERM, handle_signal)
