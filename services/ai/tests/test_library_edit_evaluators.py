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
