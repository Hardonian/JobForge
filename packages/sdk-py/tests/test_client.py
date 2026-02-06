import httpx
import pytest

from jobforge_sdk.client import JobForgeClient, JobForgeError


def test_client_base_url_is_normalized() -> None:
    client = JobForgeClient("https://example.com/", "service-key")

    assert client._client.base_url.path == "/rest/v1"


def test_rpc_returns_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    client = JobForgeClient("https://example.com", "service-key")

    def fake_post(_: str, json: dict[str, object]) -> httpx.Response:
        request = httpx.Request("POST", "https://example.com/rest/v1/rpc/test")
        return httpx.Response(200, request=request, json={"ok": True, "payload": json})

    monkeypatch.setattr(client._client, "post", fake_post)

    payload = client._rpc("jobforge_claim_jobs", {"p_limit": 1})

    assert payload["ok"] is True
    assert payload["payload"]["p_limit"] == 1


def test_rpc_raises_on_error(monkeypatch: pytest.MonkeyPatch) -> None:
    client = JobForgeClient("https://example.com", "service-key")

    def fake_post(_: str, json: dict[str, object]) -> httpx.Response:
        request = httpx.Request("POST", "https://example.com/rest/v1/rpc/test")
        return httpx.Response(400, request=request, text="bad request")

    monkeypatch.setattr(client._client, "post", fake_post)

    try:
        client._rpc("jobforge_claim_jobs", {"p_limit": 1})
    except JobForgeError as exc:
        assert "RPC call failed" in str(exc)
        return

    raise AssertionError("Expected JobForgeError")
