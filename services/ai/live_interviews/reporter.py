"""Deliver one live connection's reports and heartbeats to Rails, in order and at most once in effect.

The controller decides what happened; this module decides how it reaches Rails, and knows nothing
about LiveKit. Reports go in order and one whose answer was lost is resent unchanged before
anything newer; a lost heartbeat is resent unchanged before the next one; Rails' answers that
matter to the controller (a prompt's receipt, a refused answer, the connection ending) go back
to it as events. Only counts and the controller's report fields are sent, and spoken text is
never logged. The rules are in docs/architecture/interview-sessions.md, "Questions, answers and
coaching" and "Time, live minutes and heartbeats".
"""

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from live_interviews.client import (
    HeartbeatReply,
    LiveConnectionEnded,
    RailsClientError,
    RailsTransportError,
)
from live_interviews.controller import (
    AnswerNotSaved,
    ConnectionEnded,
    LiveEvent,
    PromptRecorded,
    ReportAnswerFinished,
    ReportFeedbackGiven,
    ReportFinish,
    ReportPromptAsked,
    ReportQuestionAdvanced,
    ReportQuestionRetried,
    SendHeartbeat,
)
from live_interviews.usage import LiveUsageTotals, heartbeat_usage

logger = logging.getLogger(__name__)

InterviewReport = (ReportPromptAsked | ReportAnswerFinished | ReportQuestionAdvanced | ReportFeedbackGiven
                   | ReportQuestionRetried)
_LOST = object()  # a call sent without a trustworthy answer
_BUG_CODES = frozenset({"unknown_usage_model", "invalid_request"})  # refusals that mean the agent and Rails disagree


@dataclass(frozen=True)
class _PendingHeartbeat:
    """A heartbeat exactly as sent, kept until Rails gives a definite answer."""

    sequence: int
    billed_seconds_delta: int
    usage: list
    totals: LiveUsageTotals


class LiveReporter:
    """Send one connection's interview reports, heartbeats and finish to Rails.

    `on_event(event)` hears what Rails' answers mean for the controller (`PromptRecorded`,
    `AnswerNotSaved`, `ConnectionEnded`) and returns the reports that raises, to send next.
    `usage_totals()` returns the session's running provider usage for heartbeats.
    """

    def __init__(self, rails, connection_id: str, *, usage_totals: Callable[[], LiveUsageTotals],
                 on_event: Callable[[LiveEvent], Awaitable[list]]):
        self._rails, self._connection_id = rails, connection_id
        self._usage_totals, self._on_event = usage_totals, on_event
        self.ended = False  # Rails said the connection or interview is over; nothing more is sent
        self._reports: list = []  # interview reports not yet answered by Rails, oldest first
        self._flushing = False
        self._acknowledged = LiveUsageTotals()  # usage Rails has acknowledged in heartbeats
        self._unsent_seconds = 0  # billed seconds no applied heartbeat has carried yet
        self._pending: _PendingHeartbeat | None = None  # sent, but Rails' answer was lost

    async def send(self, report) -> None:
        """Queue an interview report behind any unanswered ones and send what can be sent."""
        self._reports.append(report)
        await self.flush()

    async def flush(self) -> None:
        """Send queued reports in order, stopping at one whose answer is lost (it is resent later)."""
        if self._flushing:  # a report queued while sending waits for the running loop
            return
        self._flushing = True
        try:
            while self._reports and not self.ended:
                report = self._reports[0]
                outcome = await self._post_report(report)
                if outcome is _LOST:
                    return
                self._reports.pop(0)
                event = _report_outcome(report, outcome)
                if event is not None and not self.ended:
                    self._reports[0:0] = await self._on_event(event)
        finally:
            self._flushing = False

    async def heartbeat(self, action: SendHeartbeat) -> HeartbeatReply | None:
        """Report counted seconds and new priced usage, after resending a lost heartbeat unchanged.
        Interview reports still waiting behind a lost one are retried first. Returns Rails' reply
        to the new heartbeat, or None when it was not sent or got no definite answer."""
        await self.flush()
        if self._pending is not None and await self._post_heartbeat(self._pending) is _LOST:
            self._unsent_seconds += action.billed_seconds_delta
            return None
        if self.ended:
            return None
        totals = self._usage_totals()
        self._pending = _PendingHeartbeat(action.sequence, action.billed_seconds_delta + self._unsent_seconds,
                                          heartbeat_usage(totals, self._acknowledged), totals)
        self._unsent_seconds = 0
        reply = await self._post_heartbeat(self._pending)
        return reply if isinstance(reply, HeartbeatReply) else None

    async def finish(self, action: ReportFinish) -> bool:
        """Tell Rails the interview is over (after a last try for lost reports); True once accepted."""
        await self.flush()
        return await self._call(self._rails.finish, reason=action.reason,
                                final_sequence=action.final_sequence) is not None

    async def _call(self, call, *, lost=None, **values):
        """Call Rails; a refusal means the report was stale, so it is logged (never its text) and skipped.

        Returns None for a refusal and `lost` when no trustworthy answer arrived."""
        try:
            return await call(self._connection_id, **values)
        except LiveConnectionEnded:
            logger.info("Live connection ended by Rails during %s; leaving", call.__name__)
            if not self.ended:
                self.ended = True
                await self._on_event(ConnectionEnded())
            return None
        except RailsClientError as error:
            # A heartbeat naming a model Rails does not bill, or any malformed request
            # (`invalid_request`), is refused every time: a bug, so an error, not a stale report.
            log = logger.error if error.code in _BUG_CODES else logger.warning
            log("Live report %s was refused: %s", call.__name__, error.code or type(error).__name__)
            return None
        except RailsTransportError as error:
            logger.warning("Live report %s was not saved: %s", call.__name__, type(error).__name__)
            return lost

    async def _post_report(self, report):
        if isinstance(report, ReportPromptAsked):
            return await self._call(self._rails.prompt_asked, lost=_LOST, question_position=report.question_position,
                                    kind=report.kind, text=report.text,
                                    **({"prompt_key": report.prompt_key} if report.prompt_key else {}))
        if isinstance(report, ReportAnswerFinished):
            return await self._call(self._rails.answer_finished, lost=_LOST,
                                    prompt_message_id=report.prompt_message_id, transcript=report.transcript)
        if isinstance(report, ReportQuestionAdvanced):
            return await self._call(self._rails.question_advanced, lost=_LOST,
                                    question_position=report.question_position)
        if isinstance(report, ReportFeedbackGiven):
            return await self._call(self._rails.feedback_given, lost=_LOST,
                                    question_position=report.question_position, text=report.text)
        return await self._call(self._rails.question_retried, lost=_LOST,
                                question_position=report.question_position, retry_number=report.retry_number)

    async def _post_heartbeat(self, heartbeat: _PendingHeartbeat):
        """Send one heartbeat. Returns Rails' reply once applied or replayed, `_LOST` when no answer
        came (it stays pending, to be resent unchanged) or None when Rails refused it (not applied,
        so its seconds wait for the next heartbeat and its usage is counted again from the last
        acknowledged totals)."""
        reply = await self._call(self._rails.heartbeat, lost=_LOST, sequence=heartbeat.sequence,
                                 billed_seconds_delta=heartbeat.billed_seconds_delta, usage=heartbeat.usage)
        if reply is _LOST:
            return _LOST
        self._pending = None
        if reply is None:
            self._unsent_seconds += heartbeat.billed_seconds_delta
            return None
        self._acknowledged = heartbeat.totals
        return reply


def _report_outcome(report, outcome) -> LiveEvent | None:
    """The controller hears when Rails records a prompt, and when it refuses an answer."""
    if isinstance(report, ReportPromptAsked) and outcome and isinstance(outcome.get("message_id"), str):
        return PromptRecorded(report.question_position, outcome["message_id"], prompt_key=report.prompt_key)
    if isinstance(report, ReportAnswerFinished) and outcome is None:
        return AnswerNotSaved(report.prompt_message_id, report.transcript)
    return None
