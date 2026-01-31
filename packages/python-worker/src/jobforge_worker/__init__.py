"""
JobForge Python Worker Framework

Minimal, production-hardened worker for Postgres-native job orchestration.
Idempotent handlers, RPC-based writes, strict validation.
"""

from .config import WorkerConfig
from .worker import JobHandler, Worker

__all__ = ["WorkerConfig", "Worker", "JobHandler"]
__version__ = "0.1.0"
