"""Reject polished-but-still-vague green grades in the editing quality checks."""

import asyncio
from types import SimpleNamespace

from evals.run_library_edit_evals import EditCase, EditQuality, EditStructure


def test_polished_vague_contribution_cannot_pass_color_calibration():
    context = SimpleNamespace(
        inputs=SimpleNamespace(section="experience", expects_question=False),
        metadata={"allowed_colors": ["red", "yellow"]},
        output={"text": "Observed three doctors and assisted with care for 120 patients.",
                "color": "green", "reason": "Clear and specific."},
    )

    scores = EditStructure().evaluate(context)

    assert scores["edit_contract"] == 1
    assert scores.get("assessment_calibration") == 0


def test_honest_observation_can_receive_green_without_claiming_hands_on_care():
    context = SimpleNamespace(
        inputs=SimpleNamespace(section="experience", expects_question=False),
        metadata={"allowed_colors": ["green"]},
        output={"text": "Observed rural consultations to learn intake and referral decisions.",
                "color": "green", "reason": "Specifies the observational work and learning focus."},
    )

    assert EditStructure().evaluate(context).get("assessment_calibration") == 1


def test_quality_judge_does_not_receive_an_answer_the_agent_never_requested(monkeypatch):
    received = []

    async def judge(material, **_kwargs):
        received.append(material)
        return SimpleNamespace(score=1, reason="Faithful to the available facts.")

    monkeypatch.setattr("evals.run_library_edit_evals.judge_output", judge)
    context = SimpleNamespace(
        inputs=EditCase(library={"summary": "Clinical observer."}, section="summary",
                        feedback="Clarify this.", answer="I directed patients to the waiting area."),
        output={"text": "Clinical observer.", "color": "yellow", "reason": "Needs detail.", "question": None},
    )

    asyncio.run(EditQuality("test", 1).evaluate(context))

    assert "I directed patients to the waiting area." not in received[0]


def test_quality_judge_receives_the_review_question_and_its_answer(monkeypatch):
    received = []
    async def judge(material, **_kwargs):
        received.append(material)
        return SimpleNamespace(score=1, reason="Uses supplied evidence.")
    monkeypatch.setattr("evals.run_library_edit_evals.judge_output", judge)
    context = SimpleNamespace(
        inputs=EditCase(library={"summary": "Clinical observer."}, section="summary",
                        review_question="What did you observe?", feedback="I observed referral decisions."),
        output={"text": "Observed referral decisions.", "color": "green", "reason": "Concrete focus.", "question": None},
    )
    asyncio.run(EditQuality("test", 1).evaluate(context))
    assert "What did you observe?" in received[0]
    assert "I observed referral decisions." in received[0]


def test_quality_judge_receives_every_answered_batch_pair_without_reindexing(monkeypatch):
    received = []
    async def judge(material, **_kwargs):
        received.append(material)
        return SimpleNamespace(score=1, reason="Uses both provided answers.")
    monkeypatch.setattr("evals.run_library_edit_evals.judge_output", judge)
    context = SimpleNamespace(
        inputs=EditCase(library={"summary": "Museum visitor assistant."}, section="summary", feedback="", review_answers=[
            {"question_index": 1, "question": "How did you clarify directions?", "answer": "I used repeated route questions."},
            {"question_index": 2, "question": "What did you observe?", "answer": "Visitors found the exhibition."},
        ]),
        output={"text": "Clarified exhibition directions using visitor questions.", "color": "green", "reason": "Concrete contribution.", "question": None},
    )
    asyncio.run(EditQuality("test", 1).evaluate(context))
    assert "Review question 2" in received[0] and "User answer 2" in received[0]
    assert "Review question 3" in received[0] and "User answer 3" in received[0]
    assert "I used repeated route questions." in received[0]
    assert "Visitors found the exhibition." in received[0]
    assert "Review question 1" not in received[0]


def test_runner_hydrates_synthetic_deferred_turns_without_database_or_history_copies(monkeypatch):
    import pytest
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.library_edit_agent import library_edit_agent
    from evals import run_library_edit_evals as runner
    from screening.screen_user_text import ScreenOutcome

    case = EditCase(library={"summary": "Synthetic library evidence", "summary_record_id": "user-1", "screened_fields": ["summary"]},
                    section="summary", feedback="Clarify my role", answer="I built the billing service", expects_question=True)
    results = []
    owners = []
    def no_database(*_args, **_kwargs):
        pytest.fail("The evaluation runner must not use the production database fallback")
    monkeypatch.setattr("worker.library_edit_handler.build_database_edit_reader", no_database)
    monkeypatch.setattr("worker.library_edit_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))
    monkeypatch.setattr("screening.records.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))
    original = runner.handle_library_edit_task
    def observe(task, dependencies):
        assert not (task.input.keys() & {"library", "history", "turns", "original_text"})
        owners.append(task.user_id)
        result = original(task, dependencies)
        results.append(result)
        return result
    monkeypatch.setattr(runner, "handle_library_edit_task", observe)
    def evaluate(_dataset, improve, **_kwargs):
        output = improve(case)
        assert output["question"] == "Which service?"
        assert output["text"] == "Built the billing service"
        return SimpleNamespace(failures=[], cases=[])
    monkeypatch.setattr(runner, "evaluate_dataset", evaluate)
    calls = []
    def model(messages, info):
        calls.append(str(messages))
        assert "Synthetic library evidence" in str(messages)
        if len(calls) == 1:
            return ModelResponse(parts=[ToolCallPart("ask_user", {"question": "Which service?"}, tool_call_id="eval-q")])
        assert str(messages).count("Which service?") == 1
        assert "I built the billing service" in str(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"text": "Built the billing service", "color": "green", "reason": "Concrete contribution"})])
    with library_edit_agent.override(model=FunctionModel(model)):
        runner.run_library_edit_evals()
    assert len(calls) == 2 and len(set(owners)) == 1
    assert [result.status for result in results] == ["needs_user_input", "completed"]
    for result in results:
        encoded = str(result.message_history)
        assert all(text not in encoded for text in ("Synthetic library evidence", "Clarify my role", "I built the billing service", "reload this edit"))
        assert not any(part.get("part_kind") == "user-prompt" for message in result.message_history for part in message.get("parts", []))
    assert "eval-q" not in str(results[1].message_history)
