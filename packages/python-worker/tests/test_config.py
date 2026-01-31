"""Tests for strict environment validation."""

import pytest
from pydantic import ValidationError

from jobforge_worker.config import WorkerConfig


def test_valid_config() -> None:
    """Test valid configuration."""
    config = WorkerConfig(
        database_url="postgresql://user:pass@localhost:5432/db",
        worker_id="test-worker-01",
        api_base_url="http://localhost:3000",
    )
    assert config.worker_id == "test-worker-01"
    assert config.poll_interval_seconds == 5  # default
    assert config.environment == "development"  # default


def test_missing_required_fields() -> None:
    """Test that missing required fields raise validation error."""
    with pytest.raises(ValidationError) as exc_info:
        WorkerConfig()  # type: ignore[call-arg]

    errors = exc_info.value.errors()
    assert len(errors) == 3  # database_url, worker_id, api_base_url
    assert any(e["loc"] == ("database_url",) for e in errors)
    assert any(e["loc"] == ("worker_id",) for e in errors)
    assert any(e["loc"] == ("api_base_url",) for e in errors)


def test_invalid_worker_id() -> None:
    """Test that invalid worker_id raises validation error."""
    with pytest.raises(ValidationError) as exc_info:
        WorkerConfig(
            database_url="postgresql://user:pass@localhost:5432/db",
            worker_id="invalid worker!",  # spaces and special chars
            api_base_url="http://localhost:3000",
        )

    errors = exc_info.value.errors()
    assert any("worker_id" in str(e) for e in errors)


def test_worker_id_validation() -> None:
    """Test worker_id validation rules."""
    # Valid IDs
    for valid_id in ["worker-01", "python_worker_1", "worker-python-dev"]:
        config = WorkerConfig(
            database_url="postgresql://user:pass@localhost:5432/db",
            worker_id=valid_id,
            api_base_url="http://localhost:3000",
        )
        assert config.worker_id == valid_id

    # Invalid IDs
    for invalid_id in ["worker 01", "worker!01", "worker@dev"]:
        with pytest.raises(ValidationError):
            WorkerConfig(
                database_url="postgresql://user:pass@localhost:5432/db",
                worker_id=invalid_id,
                api_base_url="http://localhost:3000",
            )


def test_poll_interval_bounds() -> None:
    """Test poll interval validation bounds."""
    # Too low
    with pytest.raises(ValidationError):
        WorkerConfig(
            database_url="postgresql://user:pass@localhost:5432/db",
            worker_id="test-worker",
            api_base_url="http://localhost:3000",
            poll_interval_seconds=0,
        )

    # Too high
    with pytest.raises(ValidationError):
        WorkerConfig(
            database_url="postgresql://user:pass@localhost:5432/db",
            worker_id="test-worker",
            api_base_url="http://localhost:3000",
            poll_interval_seconds=301,
        )

    # Valid
    config = WorkerConfig(
        database_url="postgresql://user:pass@localhost:5432/db",
        worker_id="test-worker",
        api_base_url="http://localhost:3000",
        poll_interval_seconds=60,
    )
    assert config.poll_interval_seconds == 60


def test_is_production_property() -> None:
    """Test is_production property."""
    dev_config = WorkerConfig(
        database_url="postgresql://user:pass@localhost:5432/db",
        worker_id="test-worker",
        api_base_url="http://localhost:3000",
        environment="development",
    )
    assert not dev_config.is_production

    prod_config = WorkerConfig(
        database_url="postgresql://user:pass@localhost:5432/db",
        worker_id="test-worker",
        api_base_url="http://localhost:3000",
        environment="production",
    )
    assert prod_config.is_production


def test_database_url_str_property() -> None:
    """Test database_url_str property."""
    config = WorkerConfig(
        database_url="postgresql://user:pass@localhost:5432/db",
        worker_id="test-worker",
        api_base_url="http://localhost:3000",
    )
    assert isinstance(config.database_url_str, str)
    assert config.database_url_str.startswith("postgresql://")
