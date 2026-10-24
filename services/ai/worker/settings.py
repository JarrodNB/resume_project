"""
Description: Worker configuration loaded from environment variables.
Generative tasks default to GPT-6 Luna with reasoning disabled; environment variables
can override each task's model.
Index:
    - WorkerSettings: typed settings for SQS, S3, the read-only database, each agent's model
      and reasoning effort, the generative fallback model, the embedding model for career
      library search, and the request, tool-call, and token caps on a run
    - load_settings: builds WorkerSettings from the environment
    - worker_environment / conversation_logging_enabled: explicit local transcript gate
"""

from pydantic import Field, field_validator
from pydantic_ai.settings import ThinkingLevel
from pydantic_settings import BaseSettings

from worker.model_prices import MODEL_PRICES

SCREEN_LLM_OPTION = "llm"
DEFAULT_SCREEN_LLM_MODEL = "openai:gpt-5-nano"


class WorkerSettings(BaseSettings):
    """Typed worker settings. Each field maps to an upper-case environment variable."""

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
    resume_parsing_model: str = "openai:gpt-6-luna"
    # Parsing is copying, not reasoning; the model's default effort spent most of each run's
    # time and output tokens on reasoning. Rerun the evals before raising or lowering it.
    # Pydantic AI maps False to OpenAI reasoning_effort="none".
    resume_parsing_thinking: ThinkingLevel = False
    # Only runs for postings whose headings don't label the requirements.
    job_requirements_sorting_model: str = "openai:gpt-6-luna"
    job_requirements_sorting_thinking: ThinkingLevel = False
    # Copies title, company, and requirement lines out of a pasted job ad.
    job_posting_parse_model: str = "openai:gpt-6-luna"
    job_posting_parse_thinking: ThinkingLevel = False
    interview_feedback_model: str = "openai:gpt-6-luna"
    interview_feedback_thinking: ThinkingLevel = False
    interview_questions_model: str = "openai:gpt-6-luna"
    interview_questions_thinking: ThinkingLevel = False
    # Interview eval judging stays independent of production and comparison models.
    eval_judge_model: str = "openai:gpt-6.1-sol"
    gap_analysis_model: str = "openai:gpt-6-luna"
    gap_analysis_thinking: ThinkingLevel = False
    # The fallback runs only after an attempted primary provider failure.
    user_text_screen_model: str = "typesafe:jev-1.13.0"
    user_text_screen_fallback_model: str = SCREEN_LLM_OPTION
    user_text_screen_llm_model: str = DEFAULT_SCREEN_LLM_MODEL
    user_text_screen_timeout_seconds: float = Field(default=240, gt=0)
    # Live synthetic comparison: same decisions as 2000, with fewer requests and lower latency.
    # Keep both sizes available for repeat evaluation; overlap is 300 characters.
    user_text_screen_chunk_size: int = 4000

    @field_validator("user_text_screen_model", "user_text_screen_fallback_model")
    @classmethod
    def screen_model_candidate(cls, value: str) -> str:
        """Choose Jev, local Llama, or the separately configured LLM."""
        if value == DEFAULT_SCREEN_LLM_MODEL:
            return SCREEN_LLM_OPTION  # Older env files named the default model directly.
        if value not in ("typesafe:jev-1.13.0", "meta-llama/Llama-Prompt-Guard-2-22M",
                         SCREEN_LLM_OPTION):
            raise ValueError("Unknown user text screening model")
        return value

    @field_validator("user_text_screen_llm_model")
    @classmethod
    def screen_llm_model_candidate(cls, value: str) -> str:
        """Require a priced generative model before any screening call can bill for it."""
        if value not in MODEL_PRICES or value.startswith(("typesafe:", "openai:text-embedding")):
            raise ValueError("Screening LLM model must be a priced generative model")
        return value

    @field_validator("user_text_screen_chunk_size")
    @classmethod
    def screen_chunk_candidate(cls, value: int) -> int:
        """Only the two candidates under evaluation are accepted."""
        if value not in (2000, 4000):
            raise ValueError("Screen chunk size must be 2000 or 4000")
        return value
    resume_tailoring_model: str = "openai:gpt-6-luna"
    resume_tailoring_thinking: ThinkingLevel = False
    # Used when a generative OpenAI call hits a rate limit, 5xx, or connection error.
    # Output-validation retries stay on the primary. The same name as the primary skips it.
    generative_fallback_model: str = "openai:gpt-5-nano"
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
    # First answer, two output-validator retries, and the same three after a fallback switch.
    # The library default is 50. The next request fails the task.
    llm_request_limit: int = 6
    # No agent has tools. A tool call fails the run until one is registered and this is raised.
    llm_tool_calls_limit: int = 0
    # Reasoning tokens count as output. Above a long resume, below a runaway generation.
    llm_output_tokens_limit: int = 64_000
    # Covers the largest allowed prompt plus that output. Character caps reject a bigger prompt
    # before the call. Checked after the response, so one over-limit response is billed once.
    llm_total_tokens_limit: int = 128_000


def load_settings() -> WorkerSettings:
    """Builds WorkerSettings from the current environment."""
    return WorkerSettings()
