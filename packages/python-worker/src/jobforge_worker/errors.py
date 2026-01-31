"""Error handling and correlation ID tracking."""

import uuid
from contextvars import ContextVar
from typing import Any

# Context variable for correlation ID (async-safe)
_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)


def generate_correlation_id() -> str:
    """Generate a new correlation ID for request tracing."""
    return str(uuid.uuid4())


def get_current_correlation_id() -> str | None:
    """Get the current correlation ID from context."""
    return _correlation_id.get()


def set_correlation_id(correlation_id: str) -> None:
    """Set the correlation ID in context."""
    _correlation_id.set(correlation_id)


def clear_correlation_id() -> None:
    """Clear the correlation ID from context."""
    _correlation_id.set(None)


class JobError(Exception):
    """Base exception for job execution errors.

    Attributes:
        message: Human-readable error message
        retryable: Whether the job should be retried
        details: Additional error context
    """

    def __init__(
        self,
        message: str,
        retryable: bool = True,
        details: dict[str, Any] | None = None,
    ) -> None:
        """Initialize job error."""
        super().__init__(message)
        self.message = message
        self.retryable = retryable
        self.details = details or {}

    def __str__(self) -> str:
        """String representation of error."""
        if self.details:
            return f"{self.message} (details: {self.details})"
        return self.message


class JobValidationError(JobError):
    """Job configuration validation failed (non-retryable)."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        """Initialize validation error."""
        super().__init__(message, retryable=False, details=details)


class JobTimeoutError(JobError):
    """Job execution timed out (retryable)."""

    def __init__(self, timeout_seconds: int) -> None:
        """Initialize timeout error."""
        super().__init__(
            f"Job execution timed out after {timeout_seconds}s",
            retryable=True,
            details={"timeout_seconds": timeout_seconds},
        )


class JobRPCError(JobError):
    """RPC call to API failed (retryable)."""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        """Initialize RPC error."""
        super().__init__(
            message,
            retryable=True,
            details={"status_code": status_code} if status_code else {},
        )
