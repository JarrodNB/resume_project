"""
Description: Tests for the analyze_gaps handler (agent replaced by TestModel / FunctionModel,
database replaced by FakeGapAnalysisContextReader).
Index:
    - build_analyze_gaps_task: an analyze_gaps task for a fixed user and job
    - VALID_OUTPUT: an agent answer that passes the label checks
    - test_*: one behavior per test
"""

from uuid import uuid4

from pydantic_ai import capture_run_messages
from pydantic_ai.messages import ModelMessage, ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

from agents.gap_analysis_agent import gap_analysis_agent
from schemas.gap_analysis import GapAnalysisResult
from tests.fakes import FakeGapAnalysisContextReader, build_gap_analysis_context
from worker.analyze_gaps_handler import (
    EMPTY_LIBRARY_MESSAGE,
    JOB_NOT_FOUND_MESSAGE,
    NO_REQUIREMENTS_MESSAGE,
)
from worker.queue_messages import AiTaskMessage
from worker.task_dependencies import TaskDependencies
from worker.task_handlers import handle_ai_task

USER_ID = uuid4()
JOB_ID = uuid4()

VALID_OUTPUT = {
    "summary": "Strong Python and PostgreSQL; no Kubernetes.",
    "assessments": [
        {
            "requirement_ref": "R1",
            "verdict": "met",
            "evidence_refs": ["E1", "H1"],
            "explanation": "Python since 2018.",
        },
        {
            "requirement_ref": "R2",
            "verdict": "met",
            "evidence_refs": ["H2", "S2"],
            "explanation": "Tuned Postgres queries.",
        },
        {
            "requirement_ref": "N1",
            "verdict": "missing",
            "evidence_refs": [],
            "explanation": "No Kubernetes in the library.",
        },
    ],
}


def build_analyze_gaps_task() -> AiTaskMessage:
    """An analyze_gaps task for USER_ID's job JOB_ID."""
    return AiTaskMessage(
        ai_task_id=uuid4(), user_id=USER_ID, task_type="analyze_gaps", input={"job_id": str(JOB_ID)}
    )


def test_returns_the_analysis_with_library_evidence(
    task_dependencies: TaskDependencies, fake_context_reader: FakeGapAnalysisContextReader
) -> None:
    """The agent's labels come back as requirement text and library entries."""
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()

    with gap_analysis_agent.override(model=TestModel(custom_output_args=VALID_OUTPUT)):
        result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    assert result.status == "completed"
    analysis = GapAnalysisResult.model_validate(result.result["gap_analysis"])
    assert [item.verdict for item in analysis.assessments] == ["met", "met", "missing"]
    assert [evidence.id for evidence in analysis.assessments[1].evidence] == [
        "highlight-2",
        "skill-2",
    ]


def test_reports_token_usage(
    task_dependencies: TaskDependencies, fake_context_reader: FakeGapAnalysisContextReader
) -> None:
    """The result carries the run's tokens and cost for the configured model."""
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()

    with gap_analysis_agent.override(model=TestModel(custom_output_args=VALID_OUTPUT)):
        result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    [model_usage] = result.usage
    assert model_usage.model == task_dependencies.settings.gap_analysis_model
    assert model_usage.cost_microdollars > 0


def test_retries_when_the_model_skips_a_requirement(
    task_dependencies: TaskDependencies, fake_context_reader: FakeGapAnalysisContextReader
) -> None:
    """An answer missing R2 goes back to the model with the problem; the fixed answer is used."""
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context()
    incomplete = VALID_OUTPUT | {
        "assessments": [VALID_OUTPUT["assessments"][0], VALID_OUTPUT["assessments"][2]]
    }
    answers = [incomplete, VALID_OUTPUT]

    def answer(_messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        """Answers incompletely first, then correctly."""
        return ModelResponse(
            parts=[ToolCallPart(tool_name=info.output_tools[0].name, args=answers.pop(0))]
        )

    with (
        capture_run_messages() as messages,
        gap_analysis_agent.override(model=FunctionModel(answer)),
    ):
        result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    assert result.status == "completed"
    retry_prompts = [
        part.content
        for message in messages
        for part in message.parts
        if isinstance(part, RetryPromptPart)
    ]
    assert any("missing: R2" in str(content) for content in retry_prompts)


def test_fails_when_the_job_is_gone(task_dependencies: TaskDependencies) -> None:
    """A deleted job (or another user's) reads as missing and fails with a clear message."""
    result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == JOB_NOT_FOUND_MESSAGE


def test_fails_when_the_library_is_empty(
    task_dependencies: TaskDependencies, fake_context_reader: FakeGapAnalysisContextReader
) -> None:
    """Nothing to compare: no model call, a clear message."""
    context = build_gap_analysis_context()
    context.career_library = context.career_library.model_copy(
        update={"experiences": [], "projects": [], "educations": [], "skills": []}
    )
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = context

    result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    assert result.error_message == EMPTY_LIBRARY_MESSAGE


def test_fails_when_the_job_has_no_requirements(
    task_dependencies: TaskDependencies, fake_context_reader: FakeGapAnalysisContextReader
) -> None:
    """A job with neither requirements nor nice-to-haves fails before calling the model."""
    fake_context_reader.contexts[(USER_ID, JOB_ID)] = build_gap_analysis_context(
        requirements=[], nice_to_haves=[]
    )

    result = handle_ai_task(build_analyze_gaps_task(), task_dependencies)

    assert result.error_message == NO_REQUIREMENTS_MESSAGE
