"""Handler registration."""

from ..lib.registry import HandlerRegistry
from .http_request import http_request_handler
from .report_generate import report_generate_handler
from .webhook_deliver import webhook_deliver_handler


def register_handlers(registry: HandlerRegistry) -> None:
    """Register all job handlers."""
    # HTTP request handler
    registry.register(
        "connector.http.request",
        http_request_handler,
        validate=lambda p: isinstance(p, dict) and "url" in p,
        timeout_s=60.0,
    )

    # Webhook delivery handler
    registry.register(
        "connector.webhook.deliver",
        webhook_deliver_handler,
        validate=lambda p: isinstance(p, dict) and "target_url" in p and "event_type" in p,
        timeout_s=60.0,
    )

    # Report generation handler
    registry.register(
        "connector.report.generate",
        report_generate_handler,
        validate=lambda p: isinstance(p, dict) and "report_type" in p,
        timeout_s=300.0,
    )
