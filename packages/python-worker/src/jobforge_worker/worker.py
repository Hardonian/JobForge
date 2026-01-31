"""Core worker framework with idempotent job handlers."""

import logging
import signal
import sys
import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any

from .config import WorkerConfig
from .database import JobDatabase, JobRow
from .errors import (
    JobError,
    JobTimeoutError,
    clear_correlation_id,
    generate_correlation_id,
    set_correlation_id,
)
from .rpc import RPCClient

logger = logging.getLogger(__name__)


class JobHandler(ABC):
    """Base class for idempotent job handlers.

    Handlers MUST be idempotent - safe to run multiple times with same input.
    Use job.id as idempotency key in external systems.
    """

    @abstractmethod
    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        """Execute the job.

        Args:
            job: Job data from database
            rpc: RPC client for API writes (use instead of direct DB writes)

        Raises:
            JobError: On execution failure (will be retried if retryable=True)
        """
        pass

    @property
    def name(self) -> str:
        """Handler name (defaults to class name)."""
        return self.__class__.__name__


class Worker:
    """Job worker with polling, claiming, and execution.

    Handles:
    - Graceful shutdown (SIGTERM/SIGINT)
    - Correlation ID tracking
    - Job claiming with distributed locking
    - Idempotent execution
    - Automatic retries with backoff
    - Execution history recording
    """

    def __init__(self, config: WorkerConfig) -> None:
        """Initialize worker."""
        self.config = config
        self.db = JobDatabase(config)
        self.rpc = RPCClient(config)
        self.handlers: dict[str, JobHandler] = {}
        self.shutdown_requested = False

        # Setup logging
        logging.basicConfig(
            level=logging.INFO if config.is_production else logging.DEBUG,
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        )

        # Setup signal handlers
        signal.signal(signal.SIGTERM, self._handle_shutdown)
        signal.signal(signal.SIGINT, self._handle_shutdown)

        logger.info(
            f"Worker initialized: {config.worker_id} "
            f"(env={config.environment}, poll={config.poll_interval_seconds}s)"
        )

    def register_handler(self, job_name: str, handler: JobHandler) -> None:
        """Register a handler for a job type."""
        self.handlers[job_name] = handler
        logger.info(f"Registered handler: {job_name} -> {handler.name}")

    def register(self, job_name: str) -> Callable[[type[JobHandler]], type[JobHandler]]:
        """Decorator to register a handler.

        Usage:
            @worker.register("process_order")
            class ProcessOrderHandler(JobHandler):
                def execute(self, job, rpc):
                    ...
        """

        def decorator(handler_class: type[JobHandler]) -> type[JobHandler]:
            self.register_handler(job_name, handler_class())
            return handler_class

        return decorator

    def _handle_shutdown(self, signum: int, frame: Any) -> None:
        """Handle shutdown signals gracefully."""
        logger.info(f"Received signal {signum}, initiating graceful shutdown...")
        self.shutdown_requested = True

    def _execute_job(self, job: JobRow) -> None:
        """Execute a single job with error handling."""
        start_time = time.time()
        correlation_id = job.get("correlationId") or generate_correlation_id()
        set_correlation_id(correlation_id)

        try:
            logger.info(
                f"Executing job {job['id']} ({job['name']}) "
                f"[attempt {job['retryCount'] + 1}/{job['maxRetries']}] "
                f"correlation_id={correlation_id}"
            )

            # Get handler
            handler = self.handlers.get(job["name"])
            if not handler:
                raise JobError(
                    f"No handler registered for job type: {job['name']}",
                    retryable=False,
                )

            # Execute with timeout
            timeout_at = start_time + self.config.job_timeout_seconds
            if time.time() >= timeout_at:
                raise JobTimeoutError(self.config.job_timeout_seconds)

            handler.execute(job, self.rpc)

            # Mark as completed
            duration_ms = int((time.time() - start_time) * 1000)
            self.db.mark_job_completed(job["id"], correlation_id)
            self.db.record_execution(
                job_id=job["id"],
                status="completed",
                worker_id=self.config.worker_id,
                duration_ms=duration_ms,
                correlation_id=correlation_id,
            )

            logger.info(
                f"Job {job['id']} completed successfully "
                f"(duration={duration_ms}ms) "
                f"correlation_id={correlation_id}"
            )

        except JobError as e:
            # Known job error
            duration_ms = int((time.time() - start_time) * 1000)
            error_msg = str(e)

            logger.error(
                f"Job {job['id']} failed: {error_msg} "
                f"(retryable={e.retryable}) "
                f"correlation_id={correlation_id}"
            )

            self.db.mark_job_failed(
                job["id"], error_msg, retry=e.retryable, correlation_id=correlation_id
            )
            self.db.record_execution(
                job_id=job["id"],
                status="failed",
                worker_id=self.config.worker_id,
                duration_ms=duration_ms,
                error=error_msg,
                correlation_id=correlation_id,
            )

        except Exception as e:
            # Unexpected error (retryable by default)
            duration_ms = int((time.time() - start_time) * 1000)
            error_msg = f"Unexpected error: {type(e).__name__}: {str(e)}"

            logger.exception(
                f"Job {job['id']} failed with unexpected error correlation_id={correlation_id}"
            )

            self.db.mark_job_failed(job["id"], error_msg, retry=True, correlation_id=correlation_id)
            self.db.record_execution(
                job_id=job["id"],
                status="failed",
                worker_id=self.config.worker_id,
                duration_ms=duration_ms,
                error=error_msg,
                correlation_id=correlation_id,
            )

        finally:
            clear_correlation_id()

    def run(self) -> None:
        """Run the worker polling loop.

        Polls for jobs, claims them, and executes until shutdown.
        """
        logger.info(f"Worker {self.config.worker_id} starting...")

        # Health checks
        if not self.db.health_check():
            logger.error("Database health check failed!")
            sys.exit(1)

        if not self.rpc.health_check():
            logger.warning("API health check failed (will retry during operation)")

        logger.info(f"Registered handlers: {list(self.handlers.keys())}")
        logger.info("Worker ready, polling for jobs...")

        try:
            while not self.shutdown_requested:
                try:
                    # Claim next job
                    job = self.db.claim_next_job(self.config.worker_id)

                    if job:
                        self._execute_job(job)
                    else:
                        # No jobs available, sleep before next poll
                        time.sleep(self.config.poll_interval_seconds)

                except KeyboardInterrupt:
                    logger.info("Received keyboard interrupt, shutting down...")
                    break

                except Exception as e:
                    logger.exception(f"Error in worker loop: {e}")
                    time.sleep(self.config.poll_interval_seconds)

        finally:
            logger.info("Shutting down worker...")
            self.db.close()
            self.rpc.close()
            logger.info("Worker shutdown complete")
