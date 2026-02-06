import httpx
import pytest

from jobforge_worker.handlers.webhook_deliver import (
    generate_signature,
    webhook_deliver_handler,
)


def test_generate_signature_is_deterministic() -> None:
    payload = '{"event_id":"123"}'
    secret = "top-secret"

    signature = generate_signature(payload, secret, "sha256")

    assert signature == generate_signature(payload, secret, "sha256")


def test_webhook_deliver_handler_includes_signature(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class StubClient:
        def __init__(self, *args: object, **kwargs: object) -> None:
            self.args = args
            self.kwargs = kwargs

        def __enter__(self) -> "StubClient":
            return self

        def __exit__(self, exc_type, exc, tb) -> bool:
            return False

        def post(self, url: str, headers: dict[str, str], content: str) -> httpx.Response:
            captured["url"] = url
            captured["headers"] = headers
            captured["content"] = content
            request = httpx.Request("POST", url)
            return httpx.Response(200, request=request, text="ok")

    monkeypatch.setenv("WEBHOOK_SECRET", "secret-value")
    monkeypatch.setattr(httpx, "Client", StubClient)

    result = webhook_deliver_handler(
        {
            "target_url": "https://example.com/webhook",
            "event_type": "job.completed",
            "event_id": "1f7a3e2e-4c0b-4c49-9b1b-2a4a3b9a6b6d",
            "data": {"ok": True},
            "secret_ref": "WEBHOOK_SECRET",
        },
        {"attempt_no": 2},
    )

    assert result["delivered"] is True
    assert "X-JobForge-Signature" in captured["headers"]


def test_webhook_deliver_handler_missing_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MISSING_SECRET", raising=False)

    with pytest.raises(ValueError):
        webhook_deliver_handler(
            {
                "target_url": "https://example.com/webhook",
                "event_type": "job.completed",
                "event_id": "1f7a3e2e-4c0b-4c49-9b1b-2a4a3b9a6b6d",
                "data": {"ok": True},
                "secret_ref": "MISSING_SECRET",
            },
            {"attempt_no": 1},
        )
