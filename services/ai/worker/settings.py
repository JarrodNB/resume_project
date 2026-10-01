"""
Description: Worker configuration loaded from environment variables.
Index:
    - WorkerSettings: typed settings for SQS connection and queue names
    - load_settings: builds WorkerSettings from the environment
"""

from pydantic_settings import BaseSettings


class WorkerSettings(BaseSettings):
    """Typed worker settings. Each field maps to an upper-case environment variable."""

    aws_region: str = "us-east-1"
    sqs_endpoint_url: str | None = None
    ai_tasks_queue_name: str = "ai_tasks"
    ai_results_queue_name: str = "ai_results"
    receive_wait_seconds: int = 10


def load_settings() -> WorkerSettings:
    """Builds WorkerSettings from the current environment."""
    return WorkerSettings()
