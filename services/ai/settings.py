"""Model, screening and read-only retrieval settings shared by AI entrypoints.

Queue delivery and storage configuration live in worker.settings. A standalone
agent or HTTP execution never needs valid SQS settings to load its model options.
"""

from pydantic import Field, field_validator
from pydantic_ai.settings import ThinkingLevel
from pydantic_settings import BaseSettings

from llm.model_prices import MODEL_PRICES

SCREEN_LLM_OPTION = "llm"
DEFAULT_SCREEN_LLM_MODEL = "openai:gpt-5-nano"


class AISettings(BaseSettings):
    """Shared options read from their corresponding upper-case environment variables."""

    chat_model: str = "openai:gpt-6-luna"

    @field_validator("chat_model")
    @classmethod
    def chat_model_candidate(cls, value: str) -> str:
        if value not in {"openai:gpt-6-luna", "openai:gpt-5-nano"}:
            raise ValueError("Chat supports openai:gpt-6-luna or openai:gpt-5-nano")
        return value

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
    study_guide_model: str = "openai:gpt-6-luna"
    study_guide_thinking: ThinkingLevel = False
    interview_questions_model: str = "openai:gpt-6-luna"
    interview_questions_thinking: ThinkingLevel = False
    # Interview eval judging stays independent of production and comparison models.
    eval_judge_model: str = "openai:gpt-6.1-sol"
    library_review_model: str = "openai:gpt-6-luna"
    library_review_thinking: ThinkingLevel = False
    library_edit_model: str = "openai:gpt-6-luna"
    library_edit_thinking: ThinkingLevel = False
    # Other queued writers have no tools. Library editing allows one deferred question.
    library_edit_tool_calls_limit: int = Field(default=1, ge=0)
    gap_analysis_model: str = "openai:gpt-6-luna"
    gap_analysis_thinking: ThinkingLevel = False
    # The fallback runs only after an attempted primary provider failure.
    user_text_screen_model: str = "typesafe:jev-1.13.0"
    user_text_screen_fallback_model: str = SCREEN_LLM_OPTION
    user_text_screen_llm_model: str = DEFAULT_SCREEN_LLM_MODEL
    user_text_screen_timeout_seconds: float = Field(default=30, gt=0)
    # Live synthetic comparison: same decisions as 2000, with fewer requests and lower latency.
    # Keep both sizes available for repeat evaluation; overlap is 300 characters.
    user_text_screen_chunk_size: int = 6000

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
        if value not in MODEL_PRICES or not value.startswith("openai:") or value.startswith(
            "openai:text-embedding"):
            raise ValueError("Screening LLM model must be a priced generative model")
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


def load_settings() -> AISettings:
    """Read model, screening and retrieval options for the current execution."""
    return AISettings()
