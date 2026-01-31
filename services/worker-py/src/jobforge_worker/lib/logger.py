"""Structured JSON logger for worker."""

import json
import sys
from datetime import datetime
from typing import Any


class Logger:
    """Structured JSON logger."""

    def __init__(self, context: dict[str, Any] | None = None) -> None:
        """Initialize logger with optional context."""
        self.context = context or {}

    def child(self, context: dict[str, Any]) -> "Logger":
        """Create child logger with additional context."""
        return Logger({**self.context, **context})

    def _log(self, level: str, message: str, extra: dict[str, Any] | None = None) -> None:
        """Log structured message."""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": level,
            "message": message,
            **self.context,
            **(extra or {}),
        }
        print(json.dumps(entry), file=sys.stdout, flush=True)

    def debug(self, message: str, extra: dict[str, Any] | None = None) -> None:
        """Log debug message."""
        self._log("debug", message, extra)

    def info(self, message: str, extra: dict[str, Any] | None = None) -> None:
        """Log info message."""
        self._log("info", message, extra)

    def warn(self, message: str, extra: dict[str, Any] | None = None) -> None:
        """Log warning message."""
        self._log("warn", message, extra)

    def error(self, message: str, extra: dict[str, Any] | None = None) -> None:
        """Log error message."""
        self._log("error", message, extra)


logger = Logger()
