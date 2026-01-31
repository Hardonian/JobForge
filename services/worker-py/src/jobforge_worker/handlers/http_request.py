"""HTTP Request Connector - Python implementation."""

import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from pydantic import BaseModel, Field, field_validator


class HttpRequestPayload(BaseModel):
    """HTTP request job payload."""

    url: str
    method: str = "GET"
    headers: dict[str, str] = Field(default_factory=dict)
    body: str | dict[str, Any] | None = None
    timeout_ms: int = Field(default=30_000, ge=1, le=300_000)
    allowlist: list[str] = Field(default_factory=list)
    redact_headers: list[str] = Field(
        default_factory=lambda: ["authorization", "cookie", "set-cookie"]
    )

    @field_validator("method")
    @classmethod
    def validate_method(cls, v: str) -> str:
        """Validate HTTP method."""
        allowed = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]
        if v.upper() not in allowed:
            raise ValueError(f"Method must be one of {allowed}")
        return v.upper()

    @field_validator("url")
    @classmethod
    def validate_url(cls, v: str) -> str:
        """Basic URL validation."""
        if not v.startswith(("http://", "https://")):
            raise ValueError("URL must start with http:// or https://")
        return v


class HttpRequestResult(BaseModel):
    """HTTP request result."""

    status: int
    duration_ms: int
    response_headers: dict[str, str]
    response_body_preview: str
    success: bool


BLOCKED_HOSTS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "169.254.169.254",  # AWS metadata
    "metadata.google.internal",  # GCP metadata
}

PRIVATE_IP_PATTERNS = [
    re.compile(r"^10\."),
    re.compile(r"^172\.(1[6-9]|2[0-9]|3[0-1])\."),
    re.compile(r"^192\.168\."),
    re.compile(r"^127\."),
    re.compile(r"^0\."),
]


def validate_url_ssrf(url: str, allowlist: list[str]) -> None:
    """
    SSRF protection: validate URL against allowlist and block private IPs.

    Args:
        url: Target URL
        allowlist: List of allowed host patterns

    Raises:
        ValueError: If URL is blocked or not in allowlist
    """
    parsed = urlparse(url)
    hostname = parsed.hostname or parsed.netloc

    # Check blocked hosts
    if hostname.lower() in BLOCKED_HOSTS:
        raise ValueError(f"Blocked host: {hostname}")

    # Check private IP ranges
    for pattern in PRIVATE_IP_PATTERNS:
        if pattern.match(hostname):
            raise ValueError(f"Private IP address not allowed: {hostname}")

    # Check allowlist if provided
    if allowlist:
        allowed = False
        for pattern in allowlist:
            if "*" in pattern:
                regex = re.compile("^" + pattern.replace("*", ".*") + "$")
                if regex.match(hostname):
                    allowed = True
                    break
            elif hostname == pattern or hostname.endswith(f".{pattern}"):
                allowed = True
                break

        if not allowed:
            raise ValueError(f"Host not in allowlist: {hostname}")


def http_request_handler(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    HTTP request handler.

    Args:
        payload: Job payload
        context: Job context

    Returns:
        Request result

    Raises:
        ValueError: If validation fails
        httpx.HTTPError: If request fails
    """
    validated = HttpRequestPayload.model_validate(payload)

    # SSRF protection
    validate_url_ssrf(validated.url, validated.allowlist)

    start_time = time.time()

    with httpx.Client(timeout=validated.timeout_ms / 1000.0) as client:
        # Prepare request body
        body_data = None
        if validated.body and validated.method not in ["GET", "HEAD"]:
            body_data = validated.body

        # Make request
        response = client.request(
            method=validated.method,
            url=validated.url,
            headers=validated.headers,
            json=body_data if isinstance(validated.body, dict) else None,
            content=body_data if isinstance(validated.body, str) else None,
        )

    duration_ms = int((time.time() - start_time) * 1000)

    # Redact sensitive headers
    response_headers = {}
    for key, value in response.headers.items():
        if key.lower() not in validated.redact_headers:
            response_headers[key] = value

    # Read response body with size limit
    max_body_size = 1_000_000  # 1MB
    body_text = response.text
    if len(body_text) > max_body_size:
        response_body_preview = body_text[:max_body_size] + "... (truncated)"
    else:
        response_body_preview = body_text

    result = HttpRequestResult(
        status=response.status_code,
        duration_ms=duration_ms,
        response_headers=response_headers,
        response_body_preview=response_body_preview,
        success=response.is_success,
    )

    return result.model_dump()
