"""Example worker implementation demonstrating idempotent handlers."""

import logging
import time

from jobforge_worker import JobHandler, Worker, WorkerConfig
from jobforge_worker.database import JobRow
from jobforge_worker.errors import JobValidationError
from jobforge_worker.rpc import RPCClient

logger = logging.getLogger(__name__)


class ProcessDataHandler(JobHandler):
    """Example: Process data batch job (idempotent).

    Expected config:
        {
            "batch_id": "batch_123",
            "records": [...],
            "output_bucket": "s3://..."
        }
    """

    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        """Process data batch."""
        config = job["config"]

        # Validate config
        batch_id = config.get("batch_id")
        if not batch_id:
            raise JobValidationError("Missing required field: batch_id")

        records = config.get("records", [])
        if not records:
            raise JobValidationError("No records to process")

        logger.info(f"Processing batch {batch_id} with {len(records)} records")

        # Simulate processing
        # In production: use batch_id as idempotency key with external systems
        processed_count = 0
        for i, _record in enumerate(records):
            # Idempotent processing logic here
            # Use job['id'] or batch_id as idempotency key
            logger.debug(f"Processing record {i + 1}/{len(records)}")
            time.sleep(0.1)  # Simulate work
            processed_count += 1

        logger.info(f"Batch {batch_id} processed: {processed_count} records")


class SendEmailHandler(JobHandler):
    """Example: Send email notification (idempotent).

    Expected config:
        {
            "email_id": "email_456",
            "to": "user@example.com",
            "template": "welcome",
            "vars": {...}
        }
    """

    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        """Send email notification."""
        config = job["config"]

        # Validate config
        email_id = config.get("email_id")
        to = config.get("to")
        template = config.get("template")

        if not all([email_id, to, template]):
            raise JobValidationError("Missing required fields: email_id, to, template")

        logger.info(f"Sending email {email_id} to {to} (template={template})")

        # Simulate email sending
        # In production: use email_id as idempotency key with email provider
        # e.g., SendGrid/Mailgun with idempotency headers
        time.sleep(0.5)

        logger.info(f"Email {email_id} sent successfully")


class GenerateReportHandler(JobHandler):
    """Example: Generate analytics report (idempotent).

    Expected config:
        {
            "report_id": "report_789",
            "start_date": "2024-01-01",
            "end_date": "2024-01-31",
            "user_id": "user_123"
        }
    """

    def execute(self, job: JobRow, rpc: RPCClient) -> None:
        """Generate analytics report."""
        config = job["config"]

        report_id = config.get("report_id")
        start_date = config.get("start_date")
        end_date = config.get("end_date")

        if not all([report_id, start_date, end_date]):
            raise JobValidationError("Missing required fields: report_id, start_date, end_date")

        logger.info(f"Generating report {report_id} ({start_date} to {end_date})")

        # Simulate report generation
        # In production: check if report already exists (idempotency)
        time.sleep(2)

        # Could trigger follow-up job via RPC
        # rpc.create_job("send_email", {"email_id": f"{report_id}_notification", ...})

        logger.info(f"Report {report_id} generated successfully")


def main() -> None:
    """Run the example worker."""
    # Load configuration from environment
    config = WorkerConfig()

    # Initialize worker
    worker = Worker(config)

    # Register handlers
    worker.register_handler("process_data", ProcessDataHandler())
    worker.register_handler("send_email", SendEmailHandler())
    worker.register_handler("generate_report", GenerateReportHandler())

    # Alternative: use decorator
    # @worker.register("process_data")
    # class ProcessDataHandler(JobHandler):
    #     ...

    # Run worker (blocks until shutdown)
    worker.run()


if __name__ == "__main__":
    main()
