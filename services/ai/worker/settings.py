"""
Description: Worker configuration loaded from environment variables.
Index:
    - WorkerSettings: typed settings for SQS, S3, the read-only database, each agent's model
      and reasoning effort, and the embedding model for career library search
    - load_settings: builds WorkerSettings from the environment
"""

from pydantic_ai.settings import ThinkingEffort
from pydantic_settings import BaseSettings


class WorkerSettings(BaseSettings):
    """Typed worker settings. Each field maps to an upper-case environment variable."""

    aws_region: str = "us-east-1"
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
    resume_parsing_model: str = "openai:gpt-5-mini"
    # Parsing is copying, not reasoning; the model's default effort spent most of each run's
    # time and output tokens on reasoning. Rerun the evals before raising or lowering it.
    resume_parsing_thinking: ThinkingEffort = "low"
    # Only runs for postings whose headings don't label the requirements.
    job_requirements_sorting_model: str = "openai:gpt-5-mini"
    job_requirements_sorting_thinking: ThinkingEffort = "low"
    # Copies title, company, and requirement lines out of a pasted job ad.
    job_posting_parse_model: str = "openai:gpt-5-mini"
    job_posting_parse_thinking: ThinkingEffort = "low"
    gap_analysis_model: str = "openai:gpt-5-mini"
    gap_analysis_thinking: ThinkingEffort = "low"
    # Jev screens one user-written message at a time. `jev-latest` is the alias; the response
    # names the version that answered (jev-1.13.0 when this was added). Pin that id here after
    # the 0.7 yes-confidence bar is tuned on real screens.
    user_text_screen_model: str = "typesafe:jev-latest"
    resume_tailoring_model: str = "openai:gpt-5-mini"
    resume_tailoring_thinking: ThinkingEffort = "low"
    # Must match Rails (CareerLibraryEmbeddings::MODEL / DIMENSIONS), which embeds the library;
    # a search only matches rows embedded with this model.
    embedding_model: str = "openai:text-embedding-3-small"
    embedding_dimensions: int = 1536
    job_page_fetch_timeout_seconds: float = 20
    # Read-only ai_reader role (see infra/postgres and services/api/lib/ai_reader_access.rb).
    db_host: str = "localhost"
    db_port: int = 5432
    db_name: str = "api_development"
    db_username: str = "ai_reader"
    db_password: str = ""
    db_connect_timeout_seconds: int = 10
    # Must stay well below the ai_tasks visibility timeout (300s), so a slow run is abandoned
    # before SQS hands the same task to another worker and it runs (and bills) twice.
    llm_run_timeout_seconds: float = 240


def load_settings() -> WorkerSettings:
    """Builds WorkerSettings from the current environment."""
    return WorkerSettings()
