"""
Description: Interview feedback queue snapshots enforce the shared answer cap.
Index:
    - test_feedback_snapshot_limits: invalid input never reaches screening
"""
import pytest
from pydantic import ValidationError

from text_limits import MAX_INTERVIEW_ANSWER
from worker.interview_feedback_handler import InterviewFeedbackInput
from worker.interview_questions_handler import InterviewQuestionsInput


def test_question_snapshot_type_defaults_and_rejects_unknown():
    """Legacy generation defaults to general; unknown scopes never reach an agent."""
    data = {"question_set_id": "00000000-0000-0000-0000-000000000001"}
    assert InterviewQuestionsInput.model_validate(data).set_type == "general"
    for set_type in ("technical", "knowledge"):
        assert InterviewQuestionsInput.model_validate({**data, "set_type": set_type}).set_type == set_type
    with pytest.raises(ValidationError):
        InterviewQuestionsInput.model_validate({**data, "set_type": "quiz"})


@pytest.mark.parametrize("set_type", ["general", "technical", "knowledge"])
def test_feedback_snapshot_scope(set_type):
    """All persisted scopes reach coaching through the shared queue contract."""
    data = {"question_set_id": "00000000-0000-0000-0000-000000000001",
            "question_id": "00000000-0000-0000-0000-000000000002", "question_text": "Question?",
            "answer_text": "An answer.", "question_revision": 1, "answer_revision": 1,
            "set_type": set_type}
    assert InterviewFeedbackInput.model_validate(data).set_type == set_type
    with pytest.raises(ValidationError):
        InterviewFeedbackInput.model_validate({**data, "set_type": "quiz"})


@pytest.mark.parametrize("answer", ["", "x" * (MAX_INTERVIEW_ANSWER + 1)])
def test_feedback_snapshot_limits(answer):
    """Rejects empty and oversized feedback snapshots before model use."""
    with pytest.raises(ValidationError):
        InterviewFeedbackInput.model_validate({"question_set_id": "00000000-0000-0000-0000-000000000001",
            "question_id": "00000000-0000-0000-0000-000000000002", "question_text": "Question?",
            "answer_text": answer, "question_revision": 1, "answer_revision": 1})
