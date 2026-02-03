"""JobForge Python Worker."""

from importlib import import_module
from typing import TYPE_CHECKING, Any

__version__ = "0.1.0"

__all__ = ["Worker", "HandlerRegistry"]

if TYPE_CHECKING:
    from .lib.registry import HandlerRegistry
    from .lib.worker import Worker


def __getattr__(name: str) -> Any:
    """Lazy attribute access to avoid importing heavy modules at startup."""
    if name == "Worker":
        return import_module(".lib.worker", __name__).Worker
    if name == "HandlerRegistry":
        return import_module(".lib.registry", __name__).HandlerRegistry
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
