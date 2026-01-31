"""Pydantic models for JobForge."""

from datetime import datetime
from enum import Enum
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    """Job status enum."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    DEAD = "dead"
    CANCELED = "canceled"


class JobRow(BaseModel):
    """Job row from database."""

    id: UUID
    tenant_id: UUID
    type: str
    payload: dict[str, Any]
    status: JobStatus
    attempts: int = Field(ge=0)
    max_attempts: int = Field(ge=1)
    run_at: datetime
    locked_at: datetime | None = None
    locked_by: str | None = None
    heartbeat_at: datetime | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    idempotency_key: str | None = None
    created_by: str | None = None
    error: dict[str, Any] | None = None
    result_id: UUID | None = None
    created_at: datetime
    updated_at: datetime


class JobResultRow(BaseModel):
    """Job result row from database."""

    id: UUID
    job_id: UUID
    tenant_id: UUID
    result: dict[str, Any]
    artifact_ref: str | None = None
    created_at: datetime


class JobAttemptRow(BaseModel):
    """Job attempt row from database."""

    id: UUID
    job_id: UUID
    tenant_id: UUID
    attempt_no: int = Field(ge=1)
    started_at: datetime
    finished_at: datetime | None = None
    error: dict[str, Any] | None = None
    created_at: datetime


class ConnectorConfigRow(BaseModel):
    """Connector config row from database."""

    id: UUID
    tenant_id: UUID
    connector_type: str
    config: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class EnqueueJobParams(BaseModel):
    """Parameters for enqueuing a job."""

    tenant_id: UUID
    type: str = Field(min_length=1)
    payload: dict[str, Any]
    idempotency_key: str | None = None
    run_at: datetime | None = None
    max_attempts: int = Field(default=5, ge=1, le=10)


class ClaimJobsParams(BaseModel):
    """Parameters for claiming jobs."""

    worker_id: str = Field(min_length=1)
    limit: int = Field(default=10, ge=1, le=100)


class HeartbeatJobParams(BaseModel):
    """Parameters for heartbeating a job."""

    job_id: UUID
    worker_id: str = Field(min_length=1)


class CompleteJobParams(BaseModel):
    """Parameters for completing a job."""

    job_id: UUID
    worker_id: str = Field(min_length=1)
    status: JobStatus = Field(pattern="^(succeeded|failed)$")
    error: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    artifact_ref: str | None = None


class CancelJobParams(BaseModel):
    """Parameters for canceling a job."""

    job_id: UUID
    tenant_id: UUID


class RescheduleJobParams(BaseModel):
    """Parameters for rescheduling a job."""

    job_id: UUID
    tenant_id: UUID
    run_at: datetime


class ListJobsFilters(BaseModel):
    """Filters for listing jobs."""

    status: JobStatus | list[JobStatus] | None = None
    type: str | None = None
    limit: int = Field(default=50, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)


class ListJobsParams(BaseModel):
    """Parameters for listing jobs."""

    tenant_id: UUID
    filters: ListJobsFilters | None = None
