"""Previously published task envelopes remain executable after the database rename."""

from uuid import uuid4

from schemas.library_edit import LibraryEditInput
from worker.queue_messages import AiTaskMessage


def test_queued_edit_uses_canonical_context_and_preserves_prose_and_identity():
    record_id = str(uuid4())
    raw = {
        "section": "facts",
        "library": {"facts": [{"id": record_id, "requirement": "My context", "response": "facts"}]},
        "target": {"label": "T1", "kind": "library_fact", "record_id": record_id,
                   "field": "response", "source_digest": "a" * 64},
        "original_text": "facts", "feedback": "Keep LibraryFact and library_fact in this text.",
        "history": [{"content": "facts"}], "turn": 1,
    }
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="improve_library_entry", input=raw)
    edit = LibraryEditInput.model_validate(task.input)
    assert edit.section == "career_contexts"
    assert edit.target.kind == "career_context"
    assert edit.target.record_id == record_id
    assert edit.target.source_digest == "a" * 64
    assert edit.library.career_contexts[0].response == "facts"
    assert task.input["feedback"] == raw["feedback"]
    assert task.input["history"] == raw["history"]
    assert raw["section"] == "facts"


def test_queued_gap_evidence_and_screening_sources_use_canonical_discriminators():
    raw = {"gap_analysis": {"evidence": [{"kind": "fact", "text": "facts"}]},
           "source": {"source_type": "LibraryFact"},
           "receipt": {"record_type": "library_fact"}}
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume", input=raw)
    assert task.input["gap_analysis"]["evidence"] == [{"kind": "career_context", "text": "facts"}]
    assert task.input["source"]["source_type"] == "CareerContext"
    assert task.input["receipt"]["record_type"] == "career_context"
