"""Decide what the live interviewer does next, one event at a time.

The controller is plain Python: it never imports LiveKit, OpenAI or HTTP code. The LiveKit
adapter feeds it events (the interviewer or the candidate finished speaking, the model called a
tool, Rails saved a prompt, the candidate pressed End interview) and carries out the actions it
returns (speak, tell Rails what happened, update the room's progress, leave). Rails still owns
every saved record and refuses anything stale; the controller only keeps the live
conversation's place.

The flow per question: the interviewer asks the opening, the candidate answers (their final
transcripts may arrive in several pieces and are joined), and the interviewer may ask
follow-ups until the question has `answer_cap` answers. Moving on (a follow-up, the next
question, finishing an answer or ending) saves the pending answer for the current prompt; more
words for an already saved prompt replace its answer. After the last question the interviewer
closes warmly, and once that closing turn is spoken the interview finishes.

Tool calls always get exactly one `ToolResult`, the last action. The realtime model speaks in
reply to it, so the result says what to say next, or why the call was refused.

Question positions are zero-based, matching Rails. Feedback, the menu, retries, hints and
nudges come later.
"""

from dataclasses import dataclass
from typing import Literal

Phase = Literal["asking", "answering", "closing", "ended"]


@dataclass(frozen=True)
class Started:
    """The agent claimed its connection; Rails says which question is current, how many exist
    and how many answers (the opening's plus follow-ups') each question may have."""

    question_position: int
    question_total: int
    answer_cap: int


@dataclass(frozen=True)
class InterviewerTurnFinished:
    """The interviewer finished a spoken turn; `text` is its final transcript."""

    text: str


@dataclass(frozen=True)
class CandidateTurnFinished:
    """One final transcript of what the candidate said; an answer can arrive in several."""

    text: str


@dataclass(frozen=True)
class PromptRecorded:
    """Rails saved the prompt reported for `question_position` as message `message_id`."""

    question_position: int
    message_id: str


@dataclass(frozen=True)
class AskFollowUp:
    """Tool call: the interviewer wants to ask this follow-up about the candidate's answer."""

    question_text: str


@dataclass(frozen=True)
class FinishAnswer:
    """Tool call: the candidate has finished answering the current prompt."""


@dataclass(frozen=True)
class RepeatQuestion:
    """Tool call: the candidate asked to hear the current prompt again."""


@dataclass(frozen=True)
class NextQuestion:
    """Tool call: the interviewer is done with the current question."""


@dataclass(frozen=True)
class EndRequested:
    """The candidate chose End interview in the room."""


LiveEvent = (Started | InterviewerTurnFinished | CandidateTurnFinished | PromptRecorded | AskFollowUp
             | FinishAnswer | RepeatQuestion | NextQuestion | EndRequested)
ToolEvent = AskFollowUp | FinishAnswer | RepeatQuestion | NextQuestion


@dataclass(frozen=True)
class GenerateReply:
    """Have the realtime model speak now, following these turn instructions."""

    instructions: str


@dataclass(frozen=True)
class ReportPromptAsked:
    """Tell Rails the interviewer asked this prompt, with the words it actually spoke."""

    question_position: int
    kind: Literal["opening", "follow_up"]
    text: str


@dataclass(frozen=True)
class ReportAnswerFinished:
    """Tell Rails the candidate's (latest) answer to a saved prompt."""

    prompt_message_id: str
    transcript: str


@dataclass(frozen=True)
class ReportQuestionAdvanced:
    """Tell Rails the interview moved past this question."""

    question_position: int


@dataclass(frozen=True)
class ReportFinish:
    """Tell Rails the interview is over and why."""

    reason: Literal["completed", "ended_by_candidate"]


@dataclass(frozen=True)
class PublishRoomState:
    """Show the candidate's browser where the interview is (agent participant attributes)."""

    question_position: int
    question_total: int
    phase: Phase


@dataclass(frozen=True)
class EndSession:
    """Leave the room; nothing more will happen in this interview."""


@dataclass(frozen=True)
class ToolResult:
    """What a tool call returns to the model, which then speaks in reply to it."""

    text: str


LiveAction = (GenerateReply | ReportPromptAsked | ReportAnswerFinished | ReportQuestionAdvanced | ReportFinish
              | PublishRoomState | EndSession | ToolResult)


def _ask_question_instructions(question_position: int) -> str:
    return (f"question {question_position + 1} from the question plan. Keep its meaning and ask it as one "
            "clear question in your own natural spoken words. Then stop and let the candidate answer.")


def _opening_instructions(question_position: int) -> str:
    greeting = ("Greet the candidate warmly in one short sentence in your interviewer style, "
                "then ask " if question_position == 0 else
                "Greet the candidate briefly and say you will continue the interview, then ask ")
    return greeting + _ask_question_instructions(question_position)


NOT_STARTED = "The interview has not started yet. Wait."
ENDED = "The interview has ended. Do not ask anything else."
NOT_ANSWERED = "The candidate has not answered yet. Let them answer before you continue."
AT_CAP = ("This question has had all the follow-ups it allows. Do not ask another follow-up; "
          "call next_question to move on.")
ANSWER_SAVED = ("The answer is saved. Ask one follow-up with ask_follow_up if it would help, "
                "or call next_question to move on.")
ASK_FOLLOW_UP = ("Ask that follow-up now in one short, natural spoken question. Then stop and let the "
                 "candidate answer.")
REPEAT = ("Repeat the current question or follow-up now, clearly and with the same meaning. You may "
          "rephrase it slightly. Do not ask anything new.")
CLOSING = ("That was the last question. Thank the candidate warmly in one or two short sentences and "
           "say goodbye. Do not ask anything else or give feedback.")


class LiveInterviewController:
    """Keep one live interview's place and turn each event into the actions to take."""

    def __init__(self) -> None:
        self._question_position: int | None = None
        self._question_total = 0
        self._answer_cap = 1
        self._phase: Phase = "asking"
        self._reporting: Literal["opening", "follow_up"] | None = None  # the next interviewer turn's kind
        self._prompt_message_id: str | None = None
        self._answer_pieces: list[str] = []
        self._saved_answer: str | None = None  # what Rails last got for the current prompt
        self._answered_prompts = 0  # prompts of the current question with a saved answer

    def handle(self, event: LiveEvent) -> list[LiveAction]:
        """Return the actions for `event`, in the order the adapter should carry them out."""
        if isinstance(event, Started):
            return self._start(event)
        if isinstance(event, AskFollowUp | FinishAnswer | RepeatQuestion | NextQuestion):
            return self._tool(event)
        if self._question_position is None or self._phase == "ended":
            return []
        if isinstance(event, InterviewerTurnFinished):
            return self._interviewer_turn_finished(event)
        if isinstance(event, CandidateTurnFinished):
            if self._phase == "answering" and event.text.strip():
                self._answer_pieces.append(event.text.strip())
            return []
        if isinstance(event, PromptRecorded):
            if event.question_position == self._question_position and self._prompt_message_id is None:
                self._prompt_message_id = event.message_id
            return []
        return [*self._save_answer(), *self._finish("ended_by_candidate")]

    def _start(self, event: Started) -> list[LiveAction]:
        if self._question_position is not None:
            return []
        self._question_position, self._question_total = event.question_position, event.question_total
        self._answer_cap = event.answer_cap
        self._reporting = "opening"
        return [self._room_state(), GenerateReply(_opening_instructions(event.question_position))]

    def _interviewer_turn_finished(self, event: InterviewerTurnFinished) -> list[LiveAction]:
        text = event.text.strip()
        if not text:
            return []
        if self._phase == "closing":
            return self._finish("completed")
        if self._phase != "asking" or self._reporting is None:
            return []  # chatter, a repeat or a clarification: nothing new to save
        kind, self._reporting = self._reporting, None
        self._phase = "answering"
        return [ReportPromptAsked(self._question_position, kind, text), self._room_state()]

    def _tool(self, event: ToolEvent) -> list[LiveAction]:
        if self._question_position is None:
            return [ToolResult(NOT_STARTED)]
        if self._phase in ("closing", "ended"):
            return [ToolResult(ENDED)]
        if isinstance(event, RepeatQuestion):
            return [ToolResult(REPEAT)]
        if isinstance(event, NextQuestion):
            return self._next_question()
        if not self._has_answer():
            return [ToolResult(NOT_ANSWERED)]
        if isinstance(event, FinishAnswer):
            return [*self._save_answer(), ToolResult(ANSWER_SAVED)]
        if self._answer_count() >= self._answer_cap:
            return [ToolResult(AT_CAP)]
        actions = self._save_answer()
        self._new_prompt("follow_up")
        return [*actions, self._room_state(), ToolResult(ASK_FOLLOW_UP)]

    def _next_question(self) -> list[LiveAction]:
        position = self._question_position
        actions = [*self._save_answer(), ReportQuestionAdvanced(position)]
        if position + 1 >= self._question_total:
            self._phase = "closing"
            return [*actions, self._room_state(), ToolResult(CLOSING)]
        self._question_position = position + 1
        self._answered_prompts = 0
        self._new_prompt("opening")
        return [*actions, self._room_state(), ToolResult("Now ask " + _ask_question_instructions(position + 1))]

    def _finish(self, reason: Literal["completed", "ended_by_candidate"]) -> list[LiveAction]:
        self._phase = "ended"
        return [ReportFinish(reason), self._room_state(), EndSession()]

    def _has_answer(self) -> bool:
        return self._phase == "answering" and (bool(self._answer_pieces) or self._saved_answer is not None)

    def _answer_count(self) -> int:
        pending_new = bool(self._answer_pieces) and self._saved_answer is None
        return self._answered_prompts + int(pending_new)

    def _save_answer(self) -> list[LiveAction]:
        """Report the current prompt's answer if Rails doesn't have these exact words yet."""
        transcript = " ".join(self._answer_pieces)
        if not transcript or self._prompt_message_id is None or transcript == self._saved_answer:
            return []
        if self._saved_answer is None:
            self._answered_prompts += 1
        self._saved_answer = transcript
        return [ReportAnswerFinished(self._prompt_message_id, transcript)]

    def _new_prompt(self, kind: Literal["opening", "follow_up"]) -> None:
        self._phase, self._reporting = "asking", kind
        self._prompt_message_id, self._answer_pieces, self._saved_answer = None, [], None

    def _room_state(self) -> PublishRoomState:
        return PublishRoomState(self._question_position or 0, self._question_total, self._phase)
