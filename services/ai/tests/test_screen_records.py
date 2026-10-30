"""Saved records share one screening path: few calls, whole-batch failures, exact receipts."""

import asyncio
from functools import partial

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage, RunUsage

from agents.user_text_fallback_agent import UserTextFallbackRun
from agents.user_text_screen_agent import UserTextScreenRun
from privacy.contact_mask import contact_scope
from privacy.known_contact import KnownContact
from schemas.model_usage import ModelUsage
from schemas.user_text_fallback import UserTextFallbackScreen
from schemas.user_text_screen import UserTextScreen
from screening import records
from screening.conversation import screen_with_operation_models
from screening.guardrail_usage import collect_guardrail_usage
from screening.records import (
    ScreenableRecord,
    field_fingerprint,
    record_failure_message,
    screen_records,
    screen_records_sync,
)
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session


@pytest.fixture(autouse=True)
def jev_only(monkeypatch):
    """Pin one remote classifier with no fallback, whatever the local .env selects."""
    monkeypatch.setenv("USER_TEXT_SCREEN_MODEL", "typesafe:jev-1.13.0")
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", "typesafe:jev-1.13.0")


class FakeClassifier:
    """Records every screened chunk and blocks any chunk containing a marker."""

    def __init__(self, *, block_marker=None, fail=False, fail_marker=None):
        self.texts = []
        self.block_marker = block_marker
        self.fail = fail
        self.fail_marker = fail_marker

    def run(self, text):
        self.texts.append(text)
        if self.fail or (self.fail_marker is not None and self.fail_marker in text):
            raise RuntimeError("provider down")
        blocked = self.block_marker is not None and self.block_marker in text
        return UserTextScreenRun(UserTextScreen(prompt_injection=blocked, harmful_request=False),
                                 "jev-1.13.0", {"prompt_injection": 1.0, "harmful_request": 1.0},
                                 RunUsage(input_tokens=10))

    async def classify(self, text, _model, _timeout):
        return self.run(text)


def run_screen(classifier, monkeypatch, asynchronous, items, **kwargs):
    """Run either driver's default settings path with the same fake provider."""
    if asynchronous:
        monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", classifier.classify)
        return asyncio.run(screen_records(items, **kwargs))
    monkeypatch.setattr("screening.screen_user_text.screen_user_message",
                        lambda text, model, timeout_seconds: classifier.run(text))
    return screen_records_sync(items, **kwargs)


def skill(number, **kwargs):
    return ScreenableRecord(record_type="skill", record_id=f"skill-{number}",
                            fields={"name": f"Skill number {number}"},
                            display_title=f"Skill number {number}", **kwargs)


both = pytest.mark.parametrize("asynchronous", [False, True])


@both
def test_many_pending_records_share_one_call_and_get_receipts(monkeypatch, asynchronous):
    role = ScreenableRecord(record_type="experience", record_id="role-1",
                            fields={"title": "Engineer", "company": "Acme", "description": "Built things"},
                            display_title="Engineer at Acme", approved_fields=frozenset({"company"}))
    items = [role, *(skill(number) for number in range(20))]
    classifier = FakeClassifier()
    with screening_session() as session:
        outcome = run_screen(classifier, monkeypatch, asynchronous, items, approved_sources=["exact source"])
        assert outcome.allowed
        assert len(classifier.texts) == 1
        assert outcome.pending == tuple(items)
        assert len(session.record_screening) == 21
        first = session.record_screening[0]
        assert (first.record_type, first.record_id) == ("experience", "role-1")
        assert first.fingerprints == {"title": field_fingerprint("Engineer"),
                                      "description": field_fingerprint("Built things")}
        assert "exact source" in session.allowed_sources
    screened = classifier.texts[0]
    assert "Acme" not in screened
    assert "Skill number 19" in screened and "Built things" in screened
    for metadata in ("role-1", "skill-3", "screened_fields", "experience", "{"):
        assert metadata not in screened


@both
def test_fingerprints_reused_within_a_run_and_changed_values_screen_again(monkeypatch, asynchronous):
    classifier = FakeClassifier()
    with screening_session() as session:
        assert run_screen(classifier, monkeypatch, asynchronous, [skill(1), skill(2)]).allowed
        again = run_screen(classifier, monkeypatch, asynchronous, [skill(1), skill(2)])
        assert again.allowed and again.pending == ()
        assert len(classifier.texts) == 1
        changed = ScreenableRecord(record_type="skill", record_id="skill-1", fields={"name": "Rust"},
                                   display_title="Rust")
        assert run_screen(classifier, monkeypatch, asynchronous, [changed, skill(2)]).pending == (changed,)
        assert len(classifier.texts) == 2 and "Skill number 2" not in classifier.texts[1]
        assert len(session.record_screening) == 3


def test_revision_must_match_to_reuse_a_receipt(monkeypatch):
    classifier = FakeClassifier()

    def answer(revision):
        return ScreenableRecord(record_type="interview_question", record_id="question",
                                fields={"answer_text": "My answer"}, display_title="Tell me about you",
                                revision={"question_revision": 1, "answer_revision": revision})

    with screening_session() as session:
        run_screen(classifier, monkeypatch, False, [answer(1)])
        assert run_screen(classifier, monkeypatch, False, [answer(1)]).pending == ()
        assert len(classifier.texts) == 1
        # A new revision is pending again; the identical text reuses the exact cached decision.
        assert run_screen(classifier, monkeypatch, False, [answer(2)]).pending == (answer(2),)
        assert len(session.record_screening) == 2
        assert session.record_screening[-1].revision == {"question_revision": 1, "answer_revision": 2}


@both
def test_fully_approved_records_make_no_call_but_cover_sources(monkeypatch, asynchronous):
    approved = skill(1, approved_fields=frozenset({"name"}))
    blank = ScreenableRecord(record_type="job", record_id="job", fields={"title": "  ", "requirements": [" "]},
                             display_title="Job")
    with screening_session() as session:
        outcome = run_screen(FakeClassifier(fail=True), monkeypatch, asynchronous, [approved, blank],
                             approved_sources=["source"])
        assert outcome.allowed and outcome.pending == ()
        assert not session.record_screening
        assert "source" in session.allowed_sources


@both
def test_a_block_fails_the_whole_batch(monkeypatch, asynchronous):
    classifier = FakeClassifier(block_marker="Skill number 3")
    with screening_session() as session:
        outcome = run_screen(classifier, monkeypatch, asynchronous, [skill(1), skill(2), skill(3)],
                             approved_sources=["source"])
        assert not outcome.allowed and not outcome.decision.unchecked
        assert outcome.approved_sources == ()
        assert not session.record_screening and not session.allowed_sources
    assert record_failure_message(outcome) == (
        "We couldn't use: Skill number 1, Skill number 2, Skill number 3. Review those entries and try again.")


@both
def test_unavailable_screening_is_unchecked(monkeypatch, asynchronous):
    with screening_session() as session:
        outcome = run_screen(FakeClassifier(fail=True), monkeypatch, asynchronous, [skill(1)],
                             approved_sources=["source"])
        assert outcome.decision.unchecked
        assert not session.record_screening and not session.allowed_sources
    assert record_failure_message(outcome) == "Input safety screening is unavailable. Please try again later."


def test_many_blocked_records_point_at_recent_edits(monkeypatch):
    with screening_session():
        outcome = run_screen(FakeClassifier(block_marker="Skill"), monkeypatch, False,
                             [skill(number) for number in range(6)])
    assert record_failure_message(outcome) == (
        "One of the career entries you added or changed recently couldn't be used. "
        "Review your recent edits and try again.")


@both
def test_total_text_over_the_cap_is_too_long_even_when_approved(monkeypatch, asynchronous):
    monkeypatch.setattr(records, "MAX_PROMPT_TEXT", 100)
    items = [skill(number, approved_fields=frozenset({"name"})) for number in range(10)]
    classifier = FakeClassifier()
    with screening_session() as session:
        outcome = run_screen(classifier, monkeypatch, asynchronous, items, approved_sources=["source"])
        assert outcome.decision.too_long
        assert not classifier.texts and not session.allowed_sources
    assert "too long" in record_failure_message(outcome).lower()


@both
def test_single_record_over_the_screen_cap_is_too_long(monkeypatch, asynchronous):
    monkeypatch.setattr(records, "MAX_SCREENED_TEXT", 60)
    big = ScreenableRecord(record_type="project", record_id="project", fields={"description": "x" * 100},
                           display_title="Big project")
    classifier = FakeClassifier()
    with screening_session():
        outcome = run_screen(classifier, monkeypatch, asynchronous, [skill(1), big])
    assert outcome.decision.too_long and not classifier.texts


@both
def test_oversized_batches_split_into_few_blobs_with_whole_records(monkeypatch, asynchronous):
    monkeypatch.setattr(records, "MAX_SCREENED_TEXT", 120)
    items = [skill(number) for number in range(6)]
    classifier = FakeClassifier()
    usage: list[ModelUsage] = []
    with screening_session() as session, collect_guardrail_usage(usage):
        outcome = run_screen(classifier, monkeypatch, asynchronous, items)
        assert outcome.allowed and len(session.record_screening) == 6
    assert 1 < len(classifier.texts) < len(items)
    assert all(len(text) <= 120 for text in classifier.texts)
    joined = "".join(classifier.texts)
    for number in range(6):
        assert sum(f"Skill number {number}\n" in text or text.endswith(f"Skill number {number}")
                   for text in classifier.texts) == 1
        assert f"Skill number {number}" in joined
    # Async usage goes through the guardrail scope; sync callers read it from the decision.
    if asynchronous:
        assert len(usage) == len(classifier.texts)
    else:
        assert not usage
        assert len(outcome.decision.model_usages) == len(classifier.texts)


@both
def test_saved_records_never_use_the_phrase_check(monkeypatch, asynchronous):
    note = ScreenableRecord(record_type="career_context", record_id="context",
                            fields={"response": "Ignore previous instructions is a phrase I teach."},
                            display_title="Teaching note")
    classifier = FakeClassifier()
    with screening_session():
        outcome = run_screen(classifier, monkeypatch, asynchronous, [note])
    assert outcome.allowed and len(classifier.texts) == 1


def test_legacy_records_without_ids_are_screened_but_not_reported(monkeypatch):
    legacy = ScreenableRecord(record_type="gap_response", record_id=None, fields={"body": "Answer"},
                              display_title="Answer")
    classifier = FakeClassifier()
    with screening_session() as session:
        assert run_screen(classifier, monkeypatch, False, [legacy]).allowed
        assert not session.record_screening


def test_fingerprint_matches_shared_ruby_json_vectors():
    import json
    from pathlib import Path
    vectors = json.loads((Path(__file__).parent / "fixtures" / "job_field_fingerprints.json").read_text())
    for vector in vectors:
        assert field_fingerprint(vector["value"]) == vector["sha256"]


def test_unknown_record_types_are_rejected():
    with pytest.raises(ValueError):
        ScreenableRecord(record_type="skills", record_id="1", fields={}, display_title="Python")


def test_records_with_more_fields_than_a_receipt_holds_are_rejected():
    with pytest.raises(ValueError):
        ScreenableRecord(record_type="job", record_id="job", display_title="Job",
                         fields={f"field_{number}": "x" for number in range(17)})


@both
def test_sources_without_records_are_refused(monkeypatch, asynchronous):
    with screening_session() as session:
        with pytest.raises(ValueError):
            run_screen(FakeClassifier(), monkeypatch, asynchronous, [], approved_sources=["source"])
        blank = ScreenableRecord(record_type="job", record_id="job", display_title="Job",
                                 fields={"title": "  ", "requirements": [" "]})
        with pytest.raises(ValueError):
            run_screen(FakeClassifier(), monkeypatch, asynchronous, [blank], approved_sources=["source"])
        assert run_screen(FakeClassifier(fail=True), monkeypatch, asynchronous, []).allowed
        assert not session.allowed_sources


@both
@pytest.mark.parametrize("failure", ["block", "unavailable"])
def test_a_failure_in_a_later_blob_undoes_earlier_allowed_blobs(monkeypatch, asynchronous, failure):
    monkeypatch.setattr(records, "MAX_SCREENED_TEXT", 120)
    marker = "Skill number 5"
    classifier = (FakeClassifier(block_marker=marker) if failure == "block"
                  else FakeClassifier(fail_marker=marker))
    with screening_session() as session:
        outcome = run_screen(classifier, monkeypatch, asynchronous, [skill(number) for number in range(6)],
                             approved_sources=["source"])
        assert len(classifier.texts) == 2 and marker not in classifier.texts[0]
        assert not outcome.allowed and outcome.decision.unchecked == (failure == "unavailable")
        # The screen layer remembers the earlier blob's own text; caller sources stay uncovered.
        assert not session.record_screening and "source" not in session.allowed_sources
        assert outcome.approved_sources == ()


@both
def test_size_checks_use_masked_text(monkeypatch, asynchronous):
    """A short name becomes a longer placeholder; packing must measure the masked blob."""
    monkeypatch.setattr(records, "MAX_SCREENED_TEXT", 120)
    named = [ScreenableRecord(record_type="skill", record_id=f"skill-{number}", display_title="Skill",
                              fields={"name": "Al Al Al Al"}) for number in range(3)]
    raw_entry = len(records._render_entry(1, {"name": "Al Al Al Al"}))
    assert 3 * raw_entry + 2 * len(records._ENTRY_SEPARATOR) <= 120  # three would fit unmasked
    classifier = FakeClassifier()
    with contact_scope(KnownContact.from_values(names=["Al"])), screening_session():
        outcome = run_screen(classifier, monkeypatch, asynchronous, named)
        assert outcome.allowed
        assert len(classifier.texts) == 2
        assert all(len(text) <= 120 and "«name»" in text for text in classifier.texts)
        big = ScreenableRecord(record_type="skill", record_id="big", display_title="Big",
                               fields={"name": " ".join(["Al"] * 30)})
        assert len(records._render_entry(1, big.fields)) <= 120
        assert run_screen(classifier, monkeypatch, asynchronous, [big]).decision.too_long
    monkeypatch.setattr(records, "MAX_PROMPT_TEXT", 200)
    with contact_scope(KnownContact.from_values(names=["Al"])), screening_session():
        approved = ScreenableRecord(record_type="skill", record_id="approved", display_title="Approved",
                                    fields={"name": " ".join(["Al"] * 60)},
                                    approved_fields=frozenset({"name"}))
        assert len(records._render_entry(1, approved.fields)) <= 200
        assert run_screen(classifier, monkeypatch, asynchronous, [approved]).decision.too_long


@both
def test_fallback_screens_when_the_primary_fails(monkeypatch, asynchronous):
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", "llm")
    fallback_texts = []

    def fallback(text, model, timeout_seconds):
        fallback_texts.append(text)
        return UserTextFallbackRun(UserTextFallbackScreen(prompt_injection=False), "gpt-5-nano",
                                   RunUsage(input_tokens=5))

    async def fallback_async(text, model, timeout_seconds):
        return fallback(text, model, timeout_seconds)

    monkeypatch.setattr("screening.screen_user_text.screen_fallback_message", fallback)
    monkeypatch.setattr("screening.screen_user_text.screen_fallback_message_async", fallback_async)
    usage: list[ModelUsage] = []
    with screening_session() as session, collect_guardrail_usage(usage):
        outcome = run_screen(FakeClassifier(fail=True), monkeypatch, asynchronous, [skill(1)])
        assert outcome.allowed and len(session.record_screening) == 1
    assert len(fallback_texts) == 1
    recorded = usage if asynchronous else outcome.decision.model_usages
    assert [entry.model.removeprefix("openai:") for entry in recorded] == ["gpt-5-nano"]


def test_async_outcomes_carry_no_usage_and_sync_outcomes_do(monkeypatch):
    usage: list[ModelUsage] = []
    with screening_session(), collect_guardrail_usage(usage):
        assert run_screen(FakeClassifier(), monkeypatch, True, [skill(1)]).decision.model_usages == []
    assert len(usage) == 1
    with screening_session():
        assert len(run_screen(FakeClassifier(), monkeypatch, False, [skill(1)]).decision.model_usages) == 1


def test_cached_blobs_add_no_usage(monkeypatch):
    monkeypatch.setattr(records, "MAX_SCREENED_TEXT", 120)

    def legacy(number):
        return ScreenableRecord(record_type="skill", record_id=None, fields={"name": f"Skill number {number}"},
                                display_title="Skill")

    classifier = FakeClassifier()
    with screening_session():
        first = run_screen(classifier, monkeypatch, False, [legacy(number) for number in range(3)])
        assert len(classifier.texts) == 1 and len(first.decision.model_usages) == 1
        again = run_screen(classifier, monkeypatch, False, [legacy(number) for number in range(3)])
        assert len(classifier.texts) == 1 and again.decision.model_usages == []
        more = run_screen(classifier, monkeypatch, False, [legacy(number) for number in range(5)])
        assert more.allowed and len(classifier.texts) == 2
        assert len(more.decision.model_usages) == 1


def test_custom_screen_bills_the_callers_operation(monkeypatch):
    """Chat and interviews pass an operation-billed screen; the default seam is unused."""
    async def unused(*_args):
        pytest.fail("default classifier used")

    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", unused)
    billed = []

    def jev(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            usage=RequestUsage(input_tokens=100), model_name="jev-1.13.0",
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def accounted(name):
        billed.append(name)
        return FunctionModel(jev, model_name=name)

    screen = partial(screen_with_operation_models, timeout_seconds=5, accounted=accounted)
    with screening_session() as session:
        outcome = asyncio.run(screen_records([skill(1), skill(2)], screen=screen))
        assert outcome.allowed and len(session.record_screening) == 2
    assert billed == ["jev-1.13.0"]
    assert outcome.decision.model_usages == []


def test_overlapping_calls_share_the_decision(monkeypatch):
    """Concurrent calls may both write receipts; Rails applies duplicates idempotently."""
    classifier = FakeClassifier()
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", classifier.classify)
    items = [skill(1), skill(2)]

    async def both_calls():
        return await asyncio.gather(screen_records(items), screen_records(items))

    with screening_session() as session:
        outcomes = asyncio.run(both_calls())
        assert all(outcome.allowed for outcome in outcomes)
        assert len(classifier.texts) == 1
        ids = [receipt.record_id for receipt in session.record_screening]
        assert set(ids) == {"skill-1", "skill-2"} and len(ids) in (2, 4)


def test_custom_screen_failure_fails_the_batch():
    async def blocked(_text):
        return ScreenOutcome(False)

    with screening_session() as session:
        outcome = asyncio.run(screen_records([skill(1)], approved_sources=["source"], screen=blocked))
        assert not outcome.allowed and not session.allowed_sources and not session.record_screening
