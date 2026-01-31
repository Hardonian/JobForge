"""JobForge Python Worker."""

from .lib.registry import HandlerRegistry
from .lib.worker import Worker

__version__ = "0.1.0"

__all__ = ["Worker", "HandlerRegistry"]
