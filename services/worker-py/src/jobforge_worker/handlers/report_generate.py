"""Report Generation Connector - Python implementation."""

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


class ReportGeneratePayload(BaseModel):
    """Report generation job payload."""

    report_type: str = Field(min_length=1)
    inputs_ref: str | None = None
    inputs_data: dict[str, Any] = Field(default_factory=dict)
    format: list[str] = Field(default_factory=lambda: ["json"])
    options: dict[str, Any] = Field(default_factory=dict)


class ReportMetadata(BaseModel):
    """Report metadata."""

    generated_at: str
    input_count: int
    output_size_bytes: int


class ReportGenerateResult(BaseModel):
    """Report generation result."""

    report_type: str
    formats: list[str]
    report_json: dict[str, Any]
    report_html: str | None = None
    report_csv: str | None = None
    artifact_ref: str | None = None
    metadata: ReportMetadata


# Report generators by type
def usage_summary_generator(inputs: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """Generate usage summary report."""
    events = inputs.get("events", [])

    return {
        "total_events": len(events),
        "period": inputs.get("period", "unknown"),
        "summary": {
            "unique_users": len({e.get("user_id") for e in events if "user_id" in e}),
            "total_actions": len(events),
        },
        "generated_at": datetime.now(UTC).isoformat(),
    }


def job_analytics_generator(inputs: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """Generate job analytics report."""
    jobs = inputs.get("jobs", [])

    status_counts: dict[str, int] = {}
    total_attempts = 0

    for job in jobs:
        status = str(job.get("status", "unknown"))
        status_counts[status] = status_counts.get(status, 0) + 1
        total_attempts += job.get("attempts", 0)

    avg_attempts = total_attempts / len(jobs) if jobs else 0

    return {
        "total_jobs": len(jobs),
        "status_breakdown": status_counts,
        "avg_attempts": avg_attempts,
        "generated_at": datetime.now(UTC).isoformat(),
    }


def tenant_usage_generator(inputs: dict[str, Any], options: dict[str, Any]) -> dict[str, Any]:
    """Generate tenant usage report."""
    return {
        "tenant_id": inputs.get("tenant_id"),
        "job_count": len(inputs.get("jobs", [])),
        "connector_count": len(inputs.get("connectors", [])),
        "period": inputs.get("period", "unknown"),
        "generated_at": datetime.now(UTC).isoformat(),
    }


REPORT_GENERATORS: dict[str, Callable[[dict[str, Any], dict[str, Any]], dict[str, Any]]] = {
    "usage-summary": usage_summary_generator,
    "job-analytics": job_analytics_generator,
    "tenant-usage": tenant_usage_generator,
}


def json_to_html(data: dict[str, Any], title: str) -> str:
    """Convert JSON report to simple HTML."""
    import html

    def render_value(value: Any) -> str:
        if value is None:
            return "<em>null</em>"
        if isinstance(value, (dict, list)):
            return f"<pre>{html.escape(json.dumps(value, indent=2))}</pre>"
        return html.escape(str(value))

    rows = "\n".join(
        f"<tr><th>{html.escape(key)}</th><td>{render_value(value)}</td></tr>"
        for key, value in data.items()
    )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{html.escape(title)}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; padding: 2rem; max-width: 1200px; margin: 0 auto; }}
    h1 {{ color: #333; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 1rem; }}
    th, td {{ padding: 0.75rem; text-align: left; border-bottom: 1px solid #ddd; }}
    th {{ background-color: #f5f5f5; font-weight: 600; }}
    pre {{ background: #f5f5f5; padding: 0.5rem; border-radius: 4px; overflow-x: auto; }}
  </style>
</head>
<body>
  <h1>{html.escape(title)}</h1>
  <table>{rows}</table>
</body>
</html>"""


def json_to_csv(data: dict[str, Any]) -> str:
    """Convert JSON report to CSV (simple two-column format)."""
    rows = ["Key,Value"]

    for key, value in data.items():
        value_str = json.dumps(value).replace('"', '""') if isinstance(value, (dict, list)) else str(value)
        rows.append(f'"{key}","{value_str}"')

    return "\n".join(rows)


def report_generate_handler(payload: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    Report generation handler.

    Args:
        payload: Job payload
        context: Job context

    Returns:
        Generated report

    Raises:
        ValueError: If report type is unknown or inputs are invalid
    """
    validated = ReportGeneratePayload.model_validate(payload)

    # Get report generator
    generator = REPORT_GENERATORS.get(validated.report_type)
    if not generator:
        raise ValueError(f"Unknown report type: {validated.report_type}")

    # Get input data
    inputs_data = validated.inputs_data

    if validated.inputs_ref and not inputs_data:
        raise ValueError("inputs_ref requires external storage integration")

    # Generate report JSON
    report_json = generator(inputs_data, validated.options)
    generated_at = datetime.now(UTC).isoformat()

    # Calculate output size
    output_size_bytes = len(json.dumps(report_json))

    result_dict: dict[str, Any] = {
        "report_type": validated.report_type,
        "formats": validated.format,
        "report_json": report_json,
        "metadata": {
            "generated_at": generated_at,
            "input_count": len(inputs_data),
            "output_size_bytes": output_size_bytes,
        },
    }

    # Generate additional formats
    if "html" in validated.format:
        report_html = json_to_html(report_json, f"Report: {validated.report_type}")
        result_dict["report_html"] = report_html
        result_dict["metadata"]["output_size_bytes"] += len(report_html)

    if "csv" in validated.format:
        report_csv = json_to_csv(report_json)
        result_dict["report_csv"] = report_csv
        result_dict["metadata"]["output_size_bytes"] += len(report_csv)

    # Store large reports as artifact ref
    if result_dict["metadata"]["output_size_bytes"] > 100_000:
        tenant_id = context.get("tenant_id")
        job_id = context.get("job_id")
        result_dict["artifact_ref"] = f"reports/{tenant_id}/{job_id}.json"

    return result_dict
