"""
Description: Interview feedback queue snapshots enforce the shared answer cap.
Index:
    - test_feedback_snapshot_limits: invalid input never reaches screening
"""
import pytest
from pydantic import ValidationError

from text_limits import MAX_INTERVIEW_ANSWER
from worker.interview_feedback_handler import InterviewFeedbackInput


@pytest.mark.parametrize("answer", ["", "x" * (MAX_INTERVIEW_ANSWER + 1)])
def test_feedback_snapshot_limits(answer):
    """Rejects empty and oversized feedback snapshots before model use."""
    with pytest.raises(ValidationError):
        InterviewFeedbackInput.model_validate({"question_set_id": "00000000-0000-0000-0000-000000000001",
            "question_id": "00000000-0000-0000-0000-000000000002", "question_text": "Question?",
            "answer_text": answer, "question_revision": 1, "answer_revision": 1})
