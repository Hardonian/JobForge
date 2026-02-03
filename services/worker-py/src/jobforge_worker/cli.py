"""JobForge Worker CLI."""

import asyncio
import os
import sys
import traceback

from .lib.logger import logger

EXIT_CODES = {"success": 0, "validation": 2, "failure": 1}
DEBUG_ENABLED = os.getenv("DEBUG", "").lower() in {"1", "true"}


def show_help() -> None:
    """Print CLI help."""
    print(
        """
JobForge Worker CLI (Python)

Usage:
  python -m jobforge_worker.cli [options]

Options:
  --once             Run a single poll cycle then exit (default: false)
  --interval=<sec>   Poll interval in seconds (default: 2)
  --help, -h         Show this help and exit

Environment:
  SUPABASE_URL                 Supabase project URL (required)
  SUPABASE_SERVICE_ROLE_KEY    Supabase service role key (required)
  WORKER_ID                    Worker ID (default: worker-py-<pid>)
  POLL_INTERVAL_S              Poll interval in seconds (default: 2)
  HEARTBEAT_INTERVAL_S         Heartbeat interval in seconds (default: 30)
  CLAIM_LIMIT                  Max jobs claimed per poll (default: 10)

Examples:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m jobforge_worker.cli
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m jobforge_worker.cli --once
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python -m jobforge_worker.cli --interval=5
"""
    )


def log_unexpected_error(message: str, error: Exception) -> None:
    """Log an unexpected error with optional stack trace."""
    logger.error(message, {"error": str(error)})
    if DEBUG_ENABLED:
        logger.error("Stack trace", {"trace": traceback.format_exc()})


def main() -> None:
    """Main CLI entrypoint."""
    try:
        args = sys.argv[1:]
        if "--help" in args or "-h" in args:
            show_help()
            sys.exit(EXIT_CODES["success"])

        try:
            from pydantic import ValidationError
            from pydantic_settings import BaseSettings
            from .handlers import register_handlers
            from .lib.registry import HandlerRegistry
            from .lib.worker import Worker
        except ImportError as exc:
            logger.error("Missing Python dependencies", {"error": str(exc)})
            sys.exit(EXIT_CODES["validation"])

        class WorkerSettings(BaseSettings):
            """Worker configuration from environment."""

            worker_id: str = f"worker-py-{os.getpid()}"
            supabase_url: str
            supabase_service_role_key: str
            poll_interval_s: float = 2.0
            heartbeat_interval_s: float = 30.0
            claim_limit: int = 10

            class Config:
                """Pydantic config."""

                env_file = ".env"
                env_file_encoding = "utf-8"

        # Load settings
        try:
            settings = WorkerSettings()  # type: ignore
        except ValidationError as e:
            logger.error("Configuration error", {"errors": str(e)})
            sys.exit(EXIT_CODES["validation"])

        # Parse CLI args
        mode = "once" if "--once" in args else "loop"

        # Override interval if provided
        for arg in args:
            if arg.startswith("--interval="):
                try:
                    settings.poll_interval_s = float(arg.split("=")[1])
                except ValueError:
                    logger.error("Invalid interval value")
                    sys.exit(EXIT_CODES["validation"])

        # Initialize registry and register handlers
        registry = HandlerRegistry()
        register_handlers(registry)

        logger.info(
            "Worker initialized",
            {
                "worker_id": settings.worker_id,
                "mode": mode,
                "registered_handlers": registry.list_types(),
            },
        )

        # Initialize worker
        worker = Worker(
            worker_id=settings.worker_id,
            supabase_url=settings.supabase_url,
            supabase_key=settings.supabase_service_role_key,
            registry=registry,
            poll_interval_s=settings.poll_interval_s,
            heartbeat_interval_s=settings.heartbeat_interval_s,
            claim_limit=settings.claim_limit,
        )

        # Run worker
        if mode == "once":
            logger.info("Running worker once")
            asyncio.run(worker.run_once())
            logger.info("Worker completed")
        else:
            logger.info("Running worker in loop mode")
            asyncio.run(worker.run())

    except KeyboardInterrupt:
        logger.info("Worker interrupted")
        sys.exit(EXIT_CODES["success"])
    except Exception as e:
        log_unexpected_error("Worker crashed", e)
        sys.exit(EXIT_CODES["failure"])


if __name__ == "__main__":
    main()
