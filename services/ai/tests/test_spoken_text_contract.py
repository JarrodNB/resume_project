"""Streamed speech must join text exactly as Rails saves spoken content.

The browser hands streamed speech over to the saved reply only when the saved text starts
with what was streamed. services/api/spec/services/interviews/message_text_spec.rb checks
the same cases against `Interviews::MessageText.spoken_content`.
"""

import pytest

from interviews.spoken_stream import spoken_text

# (acknowledgement, saved message content) -> saved spoken content, as in the Rails spec.
SAVED_CASES = [
    (("You cut the wait.", "How did you measure it?"), "You cut the wait.\n\nHow did you measure it?"),
    ((None, "How did you measure it?"), "How did you measure it?"),
    (("Thanks for that", "Tell me about a conflict."), "Thanks for that\n\nTell me about a conflict."),
]


@pytest.mark.parametrize("parts,saved", SAVED_CASES)
def test_a_streamed_follow_up_equals_the_saved_spoken_content(parts, saved):
    acknowledgement, content = parts
    assert spoken_text(acknowledgement, "continue", content) == saved


@pytest.mark.parametrize("parts,saved", SAVED_CASES)
def test_a_streamed_acknowledgement_starts_the_saved_text_when_the_interviewer_moves_on(parts, saved):
    acknowledgement, _ = parts
    streamed = spoken_text(acknowledgement, "advance", None)
    assert saved.startswith(streamed + "\n\n" if streamed else "")
