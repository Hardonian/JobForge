"""Webhook Delivery Connector - Python implementation."""

import hashlib
import hmac
import json
import os
import time
from datetime import UTC, datetime
from ipaddress import ip_address, ip_network
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field, field_validator


class WebhookDeliverPayload(BaseModel):
    """Webhook delivery job payload."""

    target_url: str
    event_type: str = Field(min_length=1)
    event_id: str  # UUID string
    data: dict[str, Any]
    secret_ref: str | None = None
    signature_algo: str = "sha256"
    timeout_ms: int = Field(default=10_000, ge=1, le=60_000)

    @field_validator("signature_algo")
    @classmethod
    def validate_algo(cls, v: str) -> str:
        """Validate signature algorithm."""
        if v not in ["sha256", "sha512"]:
            raise ValueError("signature_algo must be sha256 or sha512")
        return v


class WebhookDeliverResult(BaseModel):
    """Webhook delivery result."""

    delivered: bool
    status: int
    duration_ms: int
    response_preview: str
    signature: str | None
    timestamp: str


PRIVATE_NETWORKS = [
    ip_network("10.0.0.0/8"),
    ip_network("127.0.0.0/8"),
    ip_network("169.254.0.0/16"),
    ip_network("172.16.0.0/12"),
    ip_network("192.168.0.0/16"),
    ip_network("::1/128"),
    ip_network("fc00::/7"),
    ip_network("fe80::/10"),
]


def assert_safe_webhook_target(target_url: str) -> None:
    parsed = urlparse(target_url)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"Unsupported webhook protocol: {parsed.scheme}")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise ValueError("Webhook target hostname is required")

    if hostname in {"localhost"} or hostname.endswith((".localhost", ".local", ".internal")):
        raise ValueError(f"Unsafe webhook target hostname: {hostname}")

    try:
        ip = ip_address(hostname)
    except ValueError:
        return

    if any(ip in network for network in PRIVATE_NETWORKS):
        raise ValueError(f"Unsafe webhook target IP: {hostname}")


def generate_signature(payload: str, secret: str, algo: str) -> str:
    """
    Generate HMAC signature for webhook payload.

    Args:
        payload: JSON payload string
        secret: Signing secret
        algo: Hash algorithm (sha256 or sha512)

    Returns:
        Hex-encoded signature
    """
    hash_func = hashlib.sha256 if algo == "sha256" else hashlib.sha512
    signature = hmac.new(secret.encode(), payload.encode(), hash_func)
    return signature.hexdigest()


def webhook_deliver_handler(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Webhook delivery handler.

    Args:
        payload: Job payload
        context: Job context

    Returns:
        Delivery result
    """
    validated = WebhookDeliverPayload.model_validate(payload)
    assert_safe_webhook_target(validated.target_url)

    timestamp = datetime.now(UTC).isoformat()

    # Prepare webhook payload
    webhook_payload = {
        "event_type": validated.event_type,
        "event_id": validated.event_id,
        "timestamp": timestamp,
        "data": validated.data,
    }

    payload_string = json.dumps(webhook_payload, separators=(",", ":"))

    # Generate signature if secret provided
    signature: str | None = None
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "JobForge-Webhook/1.0",
        "X-JobForge-Event": validated.event_type,
        "X-JobForge-Event-ID": validated.event_id,
        "X-JobForge-Timestamp": timestamp,
        "X-JobForge-Delivery-Attempt": str(context.get("attempt_no", 1)),
    }

    if validated.secret_ref:
        # Fetch secret from environment using secret_ref as key
        secret = os.environ.get(validated.secret_ref)
        if not secret:
            raise ValueError(f"Secret not found: {validated.secret_ref}")

        signature = generate_signature(payload_string, secret, validated.signature_algo)
        headers["X-JobForge-Signature"] = f"{validated.signature_algo}={signature}"

    start_time = time.time()

    try:
        with httpx.Client(timeout=validated.timeout_ms / 1000.0) as client:
            response = client.post(
                validated.target_url,
                headers=headers,
                content=payload_string,
            )

        duration_ms = int((time.time() - start_time) * 1000)

        response_text = response.text
        response_preview = (
            response_text[:500] + "... (truncated)"
            if len(response_text) > 500
            else response_text
        )

        result = WebhookDeliverResult(
            delivered=response.is_success,
            status=response.status_code,
            duration_ms=duration_ms,
            response_preview=response_preview,
            signature=signature,
            timestamp=timestamp,
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)

        result = WebhookDeliverResult(
            delivered=False,
            status=0,
            duration_ms=duration_ms,
            response_preview=str(e),
            signature=signature,
            timestamp=timestamp,
        )

    return result.model_dump()
