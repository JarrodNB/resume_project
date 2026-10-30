"""Count prompt-injection classifier calls per workflow on a library that was never screened.

These are characterization tests: they pin down today's call counts so the record
screening refactor (docs/plans/record_screening.md) can show each step lowering them.
Only the classifier agents and the generation agents are faked; every workflow runs
through its production queue-handler entry point. When a later step changes a count,
update the constant here and keep the target comment honest.
"""

from dataclasses import replace
from datetime import date
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RequestUsage

from agents.gap_analysis_agent import gap_analysis_agent
from agents.job_preference_agent import job_preference_agent
from agents.resume_tailoring_agent import resume_tailoring_agent
from agents.summary_generation_agent import summary_generation_agent
from agents.user_text_fallback_agent import user_text_fallback_agent
from agents.user_text_screen_agent import user_text_screen_agent
from schemas.gap_analysis_context import (
    CareerLibrary,
    LibraryExperience,
    LibraryHighlight,
    LibrarySkill,
)
from screening.session import screening_session
from tests.fakes import build_gap_analysis_context
from tests.test_analyze_gaps_handler import VALID_OUTPUT, build_analyze_gaps_task
from worker.queue_messages import AiTaskMessage
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail

# Today's classifier call counts on a fresh library. Each target is what the plan expects
# after the step named in the comment.
TAILORING_CALLS_TODAY = 1  # job, used library fields and gap answers share one batch
GAP_ANALYSIS_CALLS_TODAY = 1  # job and library share one batch after step 5
SUMMARY_CALLS_TODAY = 1  # unchanged by batching; step 6 starts reporting its approvals
JOB_PREFERENCE_CALLS_TODAY = 1  # criteria and listing passages share one batch
SECOND_RUN_LIBRARY_CALLS = 0  # approvals from run one make the library free on run two
SECOND_RUN_TOTAL_CALLS = 1  # only the job is screened again; a re-screened summary would make it 2

LIBRARY_TEXT = ("Skill ", "Company ", "Built system")


@pytest.fixture(autouse=True)
def jev_screening_models(monkeypatch):
    """Pins the screening models so a developer's .env (e.g. the local Llama model) cannot change counts."""
    monkeypatch.setenv("USER_TEXT_SCREEN_MODEL", "typesafe:jev-1.13.0")
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", "llm")
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    monkeypatch.delenv("USER_TEXT_SCREEN_CHUNK_SIZE", raising=False)


@pytest.fixture
def classifier_calls():
    """Records every classifier request (primary and fallback) and allows everything."""
    primary, fallback = [], []

    def classify(messages, info):
        primary.append(messages[-1].parts[-1].content)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name,
                                {"prompt_injection": False, "harmful_request": False})],
            model_name="jev-1.13.0", usage=RequestUsage(input_tokens=5),
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def classify_fallback(messages, info):
        fallback.append(messages[-1].parts[-1].content)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {"prompt_injection": False})],
            model_name="fallback", usage=RequestUsage(input_tokens=5))

    with user_text_screen_agent.override(model=FunctionModel(classify, model_name="jev-1.13.0")), \
            user_text_fallback_agent.override(model=FunctionModel(classify_fallback, model_name="fallback")):
        yield SimpleNamespace(primary=primary, fallback=fallback,
                              total=lambda: len(primary) + len(fallback))


def fresh_library() -> CareerLibrary:
    """20 skills and 5 roles with 2 highlights each; no field has ever been screened."""
    return CareerLibrary(
        summary="Backend engineer.", summary_record_id="user-1",
        skills=[LibrarySkill(id=f"skill-{i}", name=f"Skill {i}", category="Tools") for i in range(20)],
        experiences=[LibraryExperience(
            id=f"experience-{i}", company=f"Company {i}", title=f"Engineer {i}",
            start_date=date(2010 + i, 1, 1), end_date=date(2011 + i, 1, 1),
            highlights=[LibraryHighlight(id=f"highlight-{i}-{j}", content=f"Built system {i}.{j}")
                        for j in range(2)])
            for i in range(5)],
    )


def fresh_context():
    context = build_gap_analysis_context()
    context.career_library = fresh_library()
    return context


def apply_library_approvals(library: CareerLibrary, receipts) -> None:
    """Does what Rails does with `library_screening`: save the checked fields on each record."""
    approved = {receipt.record_id: list(receipt.fields) for receipt in receipts}
    records = [*library.skills, *library.experiences]
    records += [highlight for role in library.experiences for highlight in role.highlights]
    for record in records:
        if record.id in approved:
            record.screened_fields = approved[record.id]
    for receipt in receipts:
        if receipt.record_type == "user":  # the profile summary
            library.screened_fields = list(receipt.fields)


def library_calls(classifier_calls) -> list[str]:
    """Classifier requests whose text contains library content (skills, roles, highlights)."""
    return [c for c in classifier_calls.primary if any(t in c for t in LIBRARY_TEXT)]


def tailor_task() -> AiTaskMessage:
    return AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume", input={
        "job_id": str(uuid4()), "gap_responses": [],
        "contact": {"full_name": "Synthetic Candidate", "email": "candidate@example.com", "links": []}})


def tailoring_generation():
    """A writer that selects nothing, so only the screening before it is under test."""
    def answer(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {"nothing_fits": True, "entries": []})],
            model_name="gpt-5-mini", usage=RequestUsage(input_tokens=11, output_tokens=5))
    return FunctionModel(answer, model_name="gpt-5-mini")


def run_like_the_worker(task, dependencies):
    """Runs a task inside a fresh screening session, as worker/main.py does.

    Returns the result and the library approvals the worker would publish (worker/main.py
    copies them from the session onto the result for Rails to save).
    """
    with screening_session(dependencies.settings.llm_run_timeout_seconds) as session:
        result = handle_ai_task(task, dependencies)
        approvals = [SimpleNamespace(record_type=receipt.record_type, record_id=receipt.record_id,
                                         fields=list(receipt.fingerprints))
                         for receipt in session.record_screening
                         if receipt.record_type not in {"job", "gap_response", "interview_question"}]
        return result, approvals


def run_tailoring(dependencies, context):
    dependencies = replace(dependencies, read_gap_analysis_context=lambda *_: context)
    with resume_tailoring_agent.override(model=tailoring_generation()):
        return run_like_the_worker(tailor_task(), dependencies)


def run_gap_analysis(dependencies, context):
    dependencies = replace(dependencies, read_gap_analysis_context=lambda *_: context)
    missing = [{"requirement_ref": ref, "verdict": "missing", "evidence_refs": [], "explanation": "None."}
               for ref in ("R1", "R2", "N1")]
    with gap_analysis_agent.override(model=TestModel(custom_output_args={**VALID_OUTPUT, "assessments": missing})):
        return run_like_the_worker(build_analyze_gaps_task(), dependencies)


def test_tailoring_screens_a_fresh_library_in_one_batch(task_dependencies, classifier_calls):
    context = fresh_context()
    result, approvals = run_tailoring(task_dependencies, context)
    assert result.status == "completed", result.error_message
    assert approvals  # approvals are reported for Rails to save
    assert classifier_calls.fallback == []
    assert classifier_calls.total() == TAILORING_CALLS_TODAY
    assert len(library_calls(classifier_calls)) == 1  # library and job share one batch

    # Second run with the reported approvals applied: the library is free, the job is not.
    apply_library_approvals(context.career_library, approvals)
    classifier_calls.primary.clear()
    classifier_calls.fallback.clear()
    second, second_approvals = run_tailoring(task_dependencies, context)
    assert second.status == "completed", second.error_message
    assert len(library_calls(classifier_calls)) == SECOND_RUN_LIBRARY_CALLS
    assert classifier_calls.total() == SECOND_RUN_TOTAL_CALLS
    assert classifier_calls.fallback == []
    assert second_approvals == []


def test_gap_analysis_screens_a_fresh_library(task_dependencies, classifier_calls):
    context = fresh_context()
    result, approvals = run_gap_analysis(task_dependencies, context)
    assert result.status == "completed", result.error_message
    assert approvals
    assert classifier_calls.fallback == []
    assert classifier_calls.total() == GAP_ANALYSIS_CALLS_TODAY
    assert len(library_calls(classifier_calls)) == 1  # one combined job/library blob

    apply_library_approvals(context.career_library, approvals)
    classifier_calls.primary.clear()
    classifier_calls.fallback.clear()
    second, second_approvals = run_gap_analysis(task_dependencies, context)
    assert second.status == "completed", second.error_message
    assert len(library_calls(classifier_calls)) == SECOND_RUN_LIBRARY_CALLS
    assert classifier_calls.total() == SECOND_RUN_TOTAL_CALLS
    assert classifier_calls.fallback == []
    assert second_approvals == []


def test_summary_generation_screens_fresh_facts(task_dependencies, classifier_calls):
    sources = [{"label": f"SKILLS_{i}_NAME", "text": f"Skill {i}", "screened": False,
                "record_id": str(uuid4())} for i in range(20)]
    sources += [{"label": f"EXPERIENCES_{i}_DESCRIPTION", "text": f"Built system {i}.", "screened": False,
                 "record_id": str(uuid4())}
                for i in range(5)]
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="generate_summary", input={
        "target_kind": "profile", "target_id": str(uuid4()), "source_digest": "a" * 64,
        "sources": sources})
    with summary_generation_agent.override(model=TestModel(custom_output_args={
            "text": "Builds systems.", "source_labels": ["EXPERIENCES_0_DESCRIPTION"]})):
        result, approvals = run_like_the_worker(task, task_dependencies)
    assert result.status == "completed", result.error_message
    assert classifier_calls.fallback == []
    assert classifier_calls.total() == SUMMARY_CALLS_TODAY
    assert len(approvals) == 25
    assert {approval.record_id for approval in approvals} == {source["record_id"] for source in sources}


def test_job_preference_check_screens_each_criterion_and_listing(task_dependencies, classifier_calls):
    def listing(n):
        return {"id": str(uuid4()), "source_digest": "a" * 64, "truncated": False, "screened": False,
                "passages": [{"id": "P1", "text": f"Listing {n} is fully remote."}]}

    values = {"profile_id": str(uuid4()), "confirmed_revision": 2,
              "criteria": [{"id": str(uuid4()), "text": f"Preference {i}", "priority": "must_have",
                            "trusted_generated": False, "screened": False} for i in range(3)],
              "listings": [listing(n) for n in range(3)]}

    def assess(messages, info):
        args = {f"c{i}_{side}": value for i in range(3)
                for side, value in (("support", "P1"), ("contradiction", "none"))}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)],
                             model_name="jev-1.13.0", usage=RequestUsage(input_tokens=100, output_tokens=5))

    task = SimpleNamespace(ai_task_id=uuid4(), task_type="check_job_preferences", input=values)
    with job_preference_agent.override(model=FunctionModel(assess, model_name="jev-1.13.0")):
        result = handle_ai_task(task, task_dependencies)
    assert result.status == "completed", result.error_message
    assert classifier_calls.fallback == []
    assert classifier_calls.total() == JOB_PREFERENCE_CALLS_TODAY


def test_gap_analysis_only_screens_library_fields_tailoring_did_not_use(task_dependencies, classifier_calls):
    context = fresh_context()
    tailored, approvals = run_tailoring(task_dependencies, context)
    assert tailored.status == "completed", tailored.error_message
    assert approvals
    apply_library_approvals(context.career_library, approvals)
    classifier_calls.primary.clear()
    classifier_calls.fallback.clear()

    gap, gap_approvals = run_gap_analysis(task_dependencies, context)
    assert gap.status == "completed", gap.error_message
    # Tailoring uses skill names only. Gap analysis must still check the categories;
    # it batches those newly used fields with the unchecked job.
    assert len(library_calls(classifier_calls)) == 0
    assert [c for c in classifier_calls.primary if "Category:" in c] != []
    assert classifier_calls.total() == 1
    assert classifier_calls.fallback == []
    assert {(a.record_type, tuple(a.fields)) for a in gap_approvals} == {("skill", ("category",))}
    assert len(gap_approvals) == 20
