"""Decide what the live interviewer does next, one event at a time.

The controller is plain Python: it never imports LiveKit, OpenAI or HTTP code. The LiveKit
adapter feeds it events (the agent started, the interviewer finished speaking) and carries out
the actions it returns (speak with these instructions, tell Rails what was asked, update the
room's progress). Rails still owns every saved record; the controller only keeps the live
conversation's place.

Question positions are zero-based, matching Rails. This first version covers the start of an
interview: greet, ask the current question, and report that opening once.
"""

from dataclasses import dataclass
from typing import Literal

Phase = Literal["asking", "answering"]


@dataclass(frozen=True)
class Started:
    """The agent claimed its connection; Rails says which question is current and how many exist."""

    question_position: int
    question_total: int


@dataclass(frozen=True)
class InterviewerTurnFinished:
    """The interviewer finished a spoken turn; `text` is its final transcript."""

    text: str


LiveEvent = Started | InterviewerTurnFinished


@dataclass(frozen=True)
class GenerateReply:
    """Have the realtime model speak now, following these turn instructions."""

    instructions: str


@dataclass(frozen=True)
class ReportPromptAsked:
    """Tell Rails the interviewer asked this prompt, with the words it actually spoke."""

    question_position: int
    kind: Literal["opening"]
    text: str


@dataclass(frozen=True)
class PublishRoomState:
    """Show the candidate's browser where the interview is (agent participant attributes)."""

    question_position: int
    question_total: int
    phase: Phase


LiveAction = GenerateReply | ReportPromptAsked | PublishRoomState


def _opening_instructions(question_position: int) -> str:
    number = question_position + 1
    greeting = ("Greet the candidate warmly in one short sentence in your interviewer style, "
                "then ask " if question_position == 0 else
                "Greet the candidate briefly and say you will continue the interview, then ask ")
    return (greeting + f"question {number} from the question plan. Keep its meaning and ask it "
            "as one clear question in your own natural spoken words. Then stop and let the "
            "candidate answer.")


class LiveInterviewController:
    """Keep one live interview's place and turn each event into the actions to take."""

    def __init__(self) -> None:
        self._question_position: int | None = None
        self._question_total = 0
        self._phase: Phase = "asking"

    def handle(self, event: LiveEvent) -> list[LiveAction]:
        """Return the actions for `event`, in the order the adapter should carry them out."""
        if isinstance(event, Started):
            return self._start(event)
        return self._interviewer_turn_finished(event)

    def _start(self, event: Started) -> list[LiveAction]:
        if self._question_position is not None:
            return []
        self._question_position, self._question_total = event.question_position, event.question_total
        return [self._room_state(), GenerateReply(_opening_instructions(event.question_position))]

    def _interviewer_turn_finished(self, event: InterviewerTurnFinished) -> list[LiveAction]:
        text = event.text.strip()
        if self._question_position is None or self._phase != "asking" or not text:
            return []
        self._phase = "answering"
        return [ReportPromptAsked(self._question_position, "opening", text), self._room_state()]

    def _room_state(self) -> PublishRoomState:
        return PublishRoomState(self._question_position or 0, self._question_total, self._phase)
