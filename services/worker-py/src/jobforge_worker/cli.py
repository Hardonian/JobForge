"""JobForge Worker CLI."""

import asyncio
import os
import sys

from pydantic import ValidationError
from pydantic_settings import BaseSettings

from .handlers import register_handlers
from .lib.logger import logger
from .lib.registry import HandlerRegistry
from .lib.worker import Worker


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


def main() -> None:
    """Main CLI entrypoint."""
    try:
        # Load settings
        try:
            settings = WorkerSettings()  # type: ignore
        except ValidationError as e:
            logger.error("Configuration error", {"errors": str(e)})
            sys.exit(1)

        # Parse CLI args
        args = sys.argv[1:]
        mode = "once" if "--once" in args else "loop"

        # Override interval if provided
        for arg in args:
            if arg.startswith("--interval="):
                try:
                    settings.poll_interval_s = float(arg.split("=")[1])
                except ValueError:
                    logger.error("Invalid interval value")
                    sys.exit(1)

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
        sys.exit(0)
    except Exception as e:
        logger.error("Worker crashed", {"error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
