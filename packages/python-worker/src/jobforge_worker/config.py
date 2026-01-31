"""Strict environment validation for worker configuration."""

from typing import Literal

from pydantic import Field, PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class WorkerConfig(BaseSettings):
    """Worker configuration with strict validation.

    All required fields MUST be set via environment variables.
    Fails fast on startup if configuration is invalid.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="forbid",  # Reject unknown env vars to catch typos
    )

    # Database connection (required)
    database_url: PostgresDsn = Field(
        description="PostgreSQL connection string",
    )

    # Worker identity (required)
    worker_id: str = Field(
        min_length=1,
        max_length=100,
        description="Unique worker identifier for distributed locking",
    )

    # API endpoint for RPC writes (required)
    api_base_url: str = Field(
        description="Base URL for JobForge API (e.g., http://localhost:3000)",
    )

    # Polling configuration
    poll_interval_seconds: int = Field(
        default=5,
        ge=1,
        le=300,
        description="Seconds between job queue polls",
    )

    max_concurrent_jobs: int = Field(
        default=5,
        ge=1,
        le=100,
        description="Maximum concurrent jobs this worker will process",
    )

    # Retry and timeout configuration
    job_timeout_seconds: int = Field(
        default=300,  # 5 minutes
        ge=10,
        le=3600,
        description="Maximum seconds a job can run before timing out",
    )

    rpc_timeout_seconds: int = Field(
        default=30,
        ge=1,
        le=300,
        description="Timeout for RPC calls to API",
    )

    # Environment
    environment: Literal["development", "production", "test"] = Field(
        default="development",
        description="Runtime environment",
    )

    @field_validator("worker_id")
    @classmethod
    def validate_worker_id(cls, v: str) -> str:
        """Ensure worker_id is URL-safe and descriptive."""
        if not v.replace("-", "").replace("_", "").isalnum():
            raise ValueError("worker_id must be alphanumeric with hyphens/underscores only")
        return v

    @property
    def is_production(self) -> bool:
        """Check if running in production mode."""
        return self.environment == "production"

    @property
    def database_url_str(self) -> str:
        """Get database URL as string (for psycopg)."""
        return str(self.database_url)
