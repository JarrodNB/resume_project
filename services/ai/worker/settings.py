"""Add queue and storage transport settings to the shared AI configuration.

Only the worker and queue-oriented tools load these delivery options. Shared
agents use settings.AISettings and do not depend on worker startup or SQS.
"""

from settings import AISettings


class WorkerSettings(AISettings):
    """Queue-process options, plus inherited model and read-only retrieval settings."""

    interview_rails_origin: str = "http://api:3000"
    interview_service_secret: str = ""
    aws_region: str = "us-east-1"
    worker_environment: str = ""
    conversation_logging_enabled: bool = True
    sqs_endpoint_url: str | None = None
    ai_tasks_queue_name: str = "ai_tasks"
    ai_results_queue_name: str = "ai_results"
    receive_wait_seconds: int = 10
    # Must equal the ai_tasks dead-letter maxReceiveCount, so the last attempt (which reports
    # "failed") happens before SQS moves the message to the dead-letter queue.
    max_task_attempts: int = 3
    retry_delay_seconds: int = 30
    s3_endpoint_url: str | None = None
    s3_uploads_bucket: str = "careergrind-uploads"


def load_settings() -> WorkerSettings:
    """Read the worker's transport and shared AI options from the environment."""
    return WorkerSettings()
