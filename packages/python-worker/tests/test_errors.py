"""Tests for error handling and correlation IDs."""

from jobforge_worker.errors import (
    JobError,
    JobRPCError,
    JobTimeoutError,
    JobValidationError,
    clear_correlation_id,
    generate_correlation_id,
    get_current_correlation_id,
    set_correlation_id,
)


def test_generate_correlation_id() -> None:
    """Test correlation ID generation."""
    id1 = generate_correlation_id()
    id2 = generate_correlation_id()

    assert isinstance(id1, str)
    assert len(id1) == 36  # UUID format
    assert id1 != id2  # Each ID is unique


def test_correlation_id_context() -> None:
    """Test correlation ID context management."""
    # Initially no correlation ID
    assert get_current_correlation_id() is None

    # Set correlation ID
    correlation_id = "test-correlation-123"
    set_correlation_id(correlation_id)
    assert get_current_correlation_id() == correlation_id

    # Clear correlation ID
    clear_correlation_id()
    assert get_current_correlation_id() is None


def test_job_error() -> None:
    """Test JobError base class."""
    error = JobError("Something went wrong", retryable=True, details={"code": 500})

    assert str(error) == "Something went wrong (details: {'code': 500})"
    assert error.message == "Something went wrong"
    assert error.retryable is True
    assert error.details == {"code": 500}


def test_job_validation_error() -> None:
    """Test JobValidationError (non-retryable)."""
    error = JobValidationError("Invalid configuration", details={"field": "batch_id"})

    assert error.retryable is False
    assert "Invalid configuration" in str(error)
    assert error.details == {"field": "batch_id"}


def test_job_timeout_error() -> None:
    """Test JobTimeoutError."""
    error = JobTimeoutError(timeout_seconds=300)

    assert error.retryable is True
    assert "300s" in str(error)
    assert error.details["timeout_seconds"] == 300


def test_job_rpc_error() -> None:
    """Test JobRPCError."""
    error = JobRPCError("API call failed", status_code=503)

    assert error.retryable is True
    assert "API call failed" in str(error)
    assert error.details["status_code"] == 503


def test_job_error_without_details() -> None:
    """Test JobError with no details."""
    error = JobError("Simple error")

    assert str(error) == "Simple error"
    assert error.details == {}
