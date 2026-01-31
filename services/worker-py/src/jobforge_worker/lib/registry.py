"""Job handler registry."""

from collections.abc import Callable
from typing import Any

JobHandler = Callable[[dict[str, Any], dict[str, Any]], Any]


class HandlerRegistration:
    """Handler registration with options."""

    def __init__(
        self,
        handler: JobHandler,
        *,
        validate: Callable[[Any], bool] | None = None,
        timeout_s: float = 300.0,
        max_attempts: int = 5,
    ) -> None:
        """Initialize handler registration."""
        self.handler = handler
        self.validate = validate
        self.timeout_s = timeout_s
        self.max_attempts = max_attempts


class HandlerRegistry:
    """Registry for job type handlers."""

    def __init__(self) -> None:
        """Initialize empty registry."""
        self._handlers: dict[str, HandlerRegistration] = {}

    def register(
        self,
        job_type: str,
        handler: JobHandler,
        *,
        validate: Callable[[Any], bool] | None = None,
        timeout_s: float = 300.0,
        max_attempts: int = 5,
    ) -> None:
        """
        Register a handler for a job type.

        Args:
            job_type: Job type identifier
            handler: Handler function
            validate: Optional payload validator
            timeout_s: Handler timeout in seconds
            max_attempts: Max retry attempts
        """
        if job_type in self._handlers:
            raise ValueError(f"Handler already registered for type: {job_type}")

        self._handlers[job_type] = HandlerRegistration(
            handler,
            validate=validate,
            timeout_s=timeout_s,
            max_attempts=max_attempts,
        )

    def get(self, job_type: str) -> HandlerRegistration | None:
        """Get handler registration for job type."""
        return self._handlers.get(job_type)

    def has(self, job_type: str) -> bool:
        """Check if handler is registered."""
        return job_type in self._handlers

    def list_types(self) -> list[str]:
        """List all registered job types."""
        return list(self._handlers.keys())
