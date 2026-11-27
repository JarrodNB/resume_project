"""Decide what the live interviewer does next, one event at a time.

The controller is plain Python: it never imports LiveKit, OpenAI or HTTP code. The LiveKit
adapter feeds it events (the interviewer or the candidate finished speaking, the model called a
tool, the candidate pressed a room button, Rails saved a prompt, the clock ticked) and carries
out the actions it returns (speak, tell Rails what happened, update the room's state, leave).
Rails still owns every saved record and refuses anything stale; the controller only keeps the
live conversation's place.

The flow per question: the interviewer asks the opening, the candidate answers (their final
transcripts may arrive in several pieces and are joined), and the interviewer may ask
follow-ups until the question has `answer_cap` answers. Moving on saves the pending answer for
the current prompt; more words for an already saved prompt replace its answer.

The coaching loop: when the question is done (the interviewer would move on, or no follow-up
is left), the interviewer steps out of role with "Quick feedback:" (one strength, one fix). The
next interviewer turn is that feedback, and its spoken words are what Rails saves. Then the
menu is offered: try again, hear the question again, get a hint, or move on. From the menu
nothing moves on without the candidate's choice, by voice (a tool call) or by button
(`MenuChoice`, mapped to the same steps). "Hear the question again" repeats the question and
re-offers the menu. Try again restarts the whole question (at most two retries; Rails removes
the earlier attempt). Hints point to an approach, never an answer, and save nothing. "How was
that?" while answering gives feedback on the answer so far and returns to the answer.

Clock ticks drive one polite nudge after about three minutes of answering a prompt, and close
the interview (`idle`) when the menu waits three minutes. After the last question the
interviewer closes warmly, and once that closing turn is spoken the interview finishes.

Tool calls always get exactly one `ToolResult`, the last action. The realtime model speaks in
reply to it, so the result says what to say next, or why the call was refused. Button choices
have no tool call, so they end with a `GenerateReply` carrying the same words instead.

Question positions are zero-based, matching Rails.
"""

from dataclasses import dataclass
from typing import Literal

Phase = Literal["asking", "answering", "feedback", "menu", "closing", "ended"]


@dataclass(frozen=True)
class Started:
    """The agent claimed its connection; Rails says which question is current, how many exist
    and how many answers (the opening's plus follow-ups') each question may have."""

    question_position: int
    question_total: int
    answer_cap: int
    retry_count: int = 0  # retries the current question already used (Rails keeps the count)


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
class GiveFeedback:
    """Tool call or "How was that?": the candidate wants feedback on their answer."""


@dataclass(frozen=True)
class OfferMenu:
    """Tool call: the candidate is done with the question or asks what they can do next."""


@dataclass(frozen=True)
class GiveHint:
    """Tool call: the candidate asked for a hint."""


@dataclass(frozen=True)
class RetryQuestion:
    """Tool call: the candidate wants to try the whole question again."""


MenuOption = Literal["retry", "repeat", "hint", "next", "feedback"]


@dataclass(frozen=True)
class MenuChoice:
    """The candidate pressed a room button (LiveKit RPC `interview.choose`)."""

    option: MenuOption


@dataclass(frozen=True)
class Tick:
    """The adapter's clock, about once a second; `now` is monotonic seconds."""

    now: float


@dataclass(frozen=True)
class EndRequested:
    """The candidate chose End interview in the room."""


LiveEvent = (Started | InterviewerTurnFinished | CandidateTurnFinished | PromptRecorded | AskFollowUp
             | FinishAnswer | RepeatQuestion | NextQuestion | GiveFeedback | OfferMenu | GiveHint | RetryQuestion
             | MenuChoice | Tick | EndRequested)
ToolEvent = (AskFollowUp | FinishAnswer | RepeatQuestion | NextQuestion | GiveFeedback | OfferMenu | GiveHint
             | RetryQuestion)


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
class ReportFeedbackGiven:
    """Tell Rails the feedback the interviewer actually spoke for this question."""

    question_position: int
    text: str


@dataclass(frozen=True)
class ReportQuestionRetried:
    """Tell Rails the candidate restarted this question (`retry_number` 1 or 2)."""

    question_position: int
    retry_number: int


@dataclass(frozen=True)
class ReportFinish:
    """Tell Rails the interview is over and why (`idle`: the menu waited too long for a choice)."""

    reason: Literal["completed", "ended_by_candidate", "idle"]


@dataclass(frozen=True)
class PublishRoomState:
    """Show the candidate's browser where the interview is (agent participant attributes)."""

    question_position: int
    question_total: int
    phase: Phase
    menu_offered: bool = False


@dataclass(frozen=True)
class EndSession:
    """Leave the room; nothing more will happen in this interview."""


@dataclass(frozen=True)
class ToolResult:
    """What a tool call returns to the model, which then speaks in reply to it."""

    text: str


LiveAction = (GenerateReply | ReportPromptAsked | ReportAnswerFinished | ReportQuestionAdvanced | ReportFeedbackGiven
              | ReportQuestionRetried | ReportFinish | PublishRoomState | EndSession | ToolResult)


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
ANSWER_SAVED = ("The answer is saved. Ask one follow-up with ask_follow_up if it would help, "
                "or call next_question to move on.")
ASK_FOLLOW_UP = ("Ask that follow-up now in one short, natural spoken question. Then stop and let the "
                 "candidate answer.")
REPEAT = ("Repeat the current question or follow-up now, clearly and with the same meaning. You may "
          "rephrase it slightly. Do not ask anything new.")
FEEDBACK_LIMIT = 1_500  # characters Rails keeps for one question's feedback
FEEDBACK_AT_END = ("This question is done. Step out of the interviewer role now: start with \"Quick feedback:\" "
                   "and, in about 20 seconds, give one specific strength and one specific fix for the candidate's "
                   "answers to this question. Give only the feedback in this turn: do not offer choices yet and do "
                   "not ask the next question.")
FEEDBACK_SO_FAR = ("Step out of the interviewer role now: start with \"Quick feedback:\" and, in about 20 seconds, "
                   "give one specific strength and one specific fix for the candidate's answer so far. Then invite "
                   "them to carry on with their answer. Do not ask anything new.")
FEEDBACK_AGAIN = ("Start with \"Quick feedback:\" and, in about 20 seconds, give the candidate one specific strength "
                  "and one specific fix for their answers to this question. Give only the feedback in this turn.")
NOTHING_TO_COACH = "The candidate has not answered yet, so there is nothing to give feedback on. Let them answer."
FEEDBACK_FIRST = "Give your quick feedback first. The candidate then chooses what to do next."
MENU = ("Now offer the candidate their choices in one short, friendly sentence: try the question again, hear the "
        "question again, get a hint, or move on. Then stop and wait for their choice. Never move on until they "
        "choose.")
CHOOSING = ("The candidate is choosing what to do next: try the question again, hear the question again, get a "
            "hint, or move on. Do not ask anything new; wait for their choice.")
MENU_AGAIN = ("Offer the candidate their choices again in one short sentence: try the question again, hear the "
              "question again, get a hint, or move on. Then wait for their choice.")
REPEAT_FROM_MENU = ("Repeat the core question clearly, with the same meaning; you may rephrase it slightly. Then "
                    "offer the choices again (try again, get a hint, or move on) and wait for their choice.")
RETRY_LIMIT = 2  # retries per question; Rails refuses a third too
NOT_ASKED = "The question has not been asked yet. Ask it first."
RETRY = ("Tell the candidate in a few words that they can start this question again from the beginning, then ask "
         "{question}")
NO_RETRIES_AT_MENU = ("The candidate has already used both retries for this question. Say so politely, then offer the "
                      "other choices: hear the question again, get a hint, or move on. Wait for their choice.")
NO_RETRIES_ANSWERING = ("The candidate has already used both retries for this question. Say so politely and let them "
                        "carry on with their answer; they can also ask for a hint or move on.")
HINT_RULE = ("Give one short hint that points to an approach, such as a structure to follow or the kind of example "
             "to pick. Never give a finished answer or words for them to recite.")
HINT = HINT_RULE + " Then let them answer."
HINT_AT_MENU = HINT_RULE + (" Then ask whether they would like to try the question again or choose something else, "
                            "and wait for their choice.")
MENU_EVENTS = {"retry": RetryQuestion, "repeat": RepeatQuestion, "hint": GiveHint, "next": NextQuestion,
               "feedback": GiveFeedback}
NUDGE_AFTER_SECONDS = 180  # of answering one prompt
MENU_IDLE_SECONDS = 180  # of the menu waiting for a choice
NUDGE = ("The candidate has been answering this for about three minutes. Politely cut in once, in one short "
         "sentence, and ask them to wrap that answer up in a sentence or two.")
IDLE_GOODBYE = ("The candidate has not chosen anything for three minutes. Say in one or two short sentences that you "
                "will stop here for now, thank them and say goodbye. Do not ask anything else.")
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
        self._after_feedback: Literal["answering", "menu"] = "menu"  # where the spoken feedback leads
        self._retries = 0  # retries the current question has used
        self._answering_since: float | None = None  # first clock tick while answering the current prompt
        self._nudged = False  # the current prompt's one nudge was given
        self._menu_since: float | None = None  # first clock tick of the menu's current wait
        self._closing_reason: Literal["completed", "idle"] = "completed"

    def handle(self, event: LiveEvent) -> list[LiveAction]:
        """Return the actions for `event`, in the order the adapter should carry them out."""
        if isinstance(event, Started):
            return self._start(event)
        if isinstance(event, ToolEvent):
            return self._tool(event)
        if self._question_position is None or self._phase == "ended":
            return []
        if isinstance(event, MenuChoice):
            *actions, result = self._tool(MENU_EVENTS[event.option]())
            return [*actions, GenerateReply(result.text)]  # no tool call to reply to, so ask the model to speak
        if isinstance(event, Tick):
            return self._tick(event.now)
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
        self._answer_cap, self._retries = event.answer_cap, event.retry_count
        self._reporting = "opening"
        return [self._room_state(), GenerateReply(_opening_instructions(event.question_position))]

    def _interviewer_turn_finished(self, event: InterviewerTurnFinished) -> list[LiveAction]:
        text = event.text.strip()
        if not text:
            return []
        if self._phase == "closing":
            return self._finish(self._closing_reason)
        if self._phase == "feedback":
            return self._feedback_spoken(text)
        if self._phase != "asking" or self._reporting is None:
            return []  # chatter, a repeat, a hint or a clarification: nothing new to save
        kind, self._reporting = self._reporting, None
        self._phase = "answering"
        return [ReportPromptAsked(self._question_position, kind, text), self._room_state()]

    def _tick(self, now: float) -> list[LiveAction]:
        """Time the one nudge per answer and the menu's idle close; waits start at their first tick."""
        if self._phase == "answering" and not self._nudged:
            if self._answering_since is None:
                self._answering_since = now
            elif now - self._answering_since >= NUDGE_AFTER_SECONDS:
                self._nudged = True
                return [GenerateReply(NUDGE)]
        elif self._phase == "menu":
            if self._menu_since is None:
                self._menu_since = now
            elif now - self._menu_since >= MENU_IDLE_SECONDS:
                self._phase, self._closing_reason = "closing", "idle"
                return [self._room_state(), GenerateReply(IDLE_GOODBYE)]
        return []

    def _feedback_spoken(self, text: str) -> list[LiveAction]:
        """The words the interviewer actually spoke as feedback are what Rails saves."""
        report = ReportFeedbackGiven(self._question_position, text[:FEEDBACK_LIMIT].rstrip())
        self._phase, self._menu_since = self._after_feedback, None
        if self._phase == "answering":
            return [report, self._room_state()]
        return [report, self._room_state(), GenerateReply(MENU)]

    def _tool(self, event: ToolEvent) -> list[LiveAction]:
        if self._question_position is None:
            return [ToolResult(NOT_STARTED)]
        if self._phase in ("closing", "ended"):
            return [ToolResult(ENDED)]
        if self._phase == "feedback":
            return [ToolResult(FEEDBACK_FIRST)]
        if self._phase == "menu":
            return self._menu_tool(event)
        if isinstance(event, GiveHint | RetryQuestion) and self._phase != "answering":
            return [ToolResult(NOT_ASKED)]
        if isinstance(event, GiveHint):
            return [ToolResult(HINT)]
        if isinstance(event, RetryQuestion):
            return self._retry(NO_RETRIES_ANSWERING)
        if isinstance(event, RepeatQuestion):
            return [ToolResult(REPEAT)]
        if isinstance(event, NextQuestion):
            return self._feedback(FEEDBACK_AT_END, then="menu") if self._answer_count() else self._advance()
        if isinstance(event, OfferMenu) and self._answer_count():
            return self._feedback(FEEDBACK_AT_END, then="menu")
        if not self._has_answer():
            return [ToolResult(NOTHING_TO_COACH if isinstance(event, GiveFeedback) else NOT_ANSWERED)]
        if isinstance(event, GiveFeedback):
            return self._feedback(FEEDBACK_SO_FAR, then="answering")
        if self._answer_count() >= self._answer_cap:
            return self._feedback(FEEDBACK_AT_END, then="menu")  # no follow-up is left for this question
        if isinstance(event, FinishAnswer):
            actions = self._save_answer()
            if self._answered_prompts >= self._answer_cap:
                return [*actions, *self._feedback(FEEDBACK_AT_END, then="menu")]
            return [*actions, ToolResult(ANSWER_SAVED)]
        actions = self._save_answer()
        self._new_prompt("follow_up")
        return [*actions, self._room_state(), ToolResult(ASK_FOLLOW_UP)]

    def _menu_tool(self, event: ToolEvent) -> list[LiveAction]:
        """At the menu only the candidate's choice moves the interview; any choice restarts the idle wait."""
        self._menu_since = None
        if isinstance(event, NextQuestion):
            return self._advance()
        if isinstance(event, RepeatQuestion):
            return [ToolResult(REPEAT_FROM_MENU)]
        if isinstance(event, GiveFeedback):
            return self._feedback(FEEDBACK_AGAIN, then="menu")
        if isinstance(event, GiveHint):
            return [ToolResult(HINT_AT_MENU)]
        if isinstance(event, RetryQuestion):
            return self._retry(NO_RETRIES_AT_MENU)
        if isinstance(event, OfferMenu):
            return [ToolResult(MENU_AGAIN)]
        return [ToolResult(CHOOSING)]

    def _retry(self, refusal: str) -> list[LiveAction]:
        """Restart the whole question: Rails drops its answers, follow-ups and feedback, keeping
        the opening, and the words said since the last save are discarded too."""
        if self._retries >= RETRY_LIMIT:
            return [ToolResult(refusal)]
        self._retries += 1
        self._answered_prompts = 0
        self._new_prompt("opening")
        return [ReportQuestionRetried(self._question_position, self._retries), self._room_state(),
                ToolResult(RETRY.format(question=_ask_question_instructions(self._question_position)))]

    def _feedback(self, instructions: str, *, then: Literal["answering", "menu"]) -> list[LiveAction]:
        actions = self._save_answer()
        self._phase, self._after_feedback = "feedback", then
        return [*actions, self._room_state(), ToolResult(instructions)]

    def _advance(self) -> list[LiveAction]:
        position = self._question_position
        actions = [*self._save_answer(), ReportQuestionAdvanced(position)]
        if position + 1 >= self._question_total:
            self._phase = "closing"
            return [*actions, self._room_state(), ToolResult(CLOSING)]
        self._question_position = position + 1
        self._answered_prompts, self._retries = 0, 0
        self._new_prompt("opening")
        return [*actions, self._room_state(), ToolResult("Now ask " + _ask_question_instructions(position + 1))]

    def _finish(self, reason: Literal["completed", "ended_by_candidate", "idle"]) -> list[LiveAction]:
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
        self._answering_since, self._nudged = None, False

    def _room_state(self) -> PublishRoomState:
        return PublishRoomState(self._question_position or 0, self._question_total, self._phase,
                                menu_offered=self._phase == "menu")
