"""Read complete question/answer snapshots published by Rails, outside model content.

Only snapshots matching the task owner, question set and selected question text can
reuse or report record state. Old or partial task inputs retain task-local screening.
"""
import json
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from schemas.record_screening import RecordScreeningState


class InterviewRecordSnapshot(BaseModel):
    user_id: UUID
    question_set_id: UUID
    question_id: UUID
    question_text: str
    answer_text: str
    observed_updated_at: datetime
    screened_at: datetime | None = None
    screening_policy_version: str | None = None

    def source(self):
        return json.dumps({"question_text": self.question_text, "answer_text": self.answer_text},
                          ensure_ascii=False, separators=(",", ":"))

    def state(self, task, question_set_id, question_text, question_id=None, answer_text=None):
        """Reject mismatched provenance rather than approving a partial source."""
        if (self.user_id != task.user_id or self.question_set_id != question_set_id
                or self.question_text != question_text
                or (question_id is not None and self.question_id != question_id)
                or (answer_text is not None and self.answer_text != answer_text)):
            raise ValueError("Interview record snapshot does not match task")
        return RecordScreeningState("InterviewQuestion", str(self.question_id),
            self.observed_updated_at, self.screened_at, self.screening_policy_version, self.source())
