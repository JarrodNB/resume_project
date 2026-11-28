"""Drive the live reporter against a fake Rails client: order, resends, receipts and heartbeats."""

import asyncio

import pytest

from live_interviews.client import HeartbeatReply, LiveConnectionEnded, RailsClientError
from live_interviews.controller import (
    AnswerNotSaved,
    ConnectionEnded,
    ProgressNotSaved,
    PromptNotSaved,
    PromptRecorded,
    ReportAnswerFinished,
    ReportFeedbackGiven,
    ReportFinish,
    ReportPromptAsked,
    ReportQuestionAdvanced,
    ReportQuestionRetried,
    SendHeartbeat,
)
from live_interviews.reporter import MAX_BUSY_ROUNDS, LiveReporter
from live_interviews.settings import REALTIME_MODEL, TRANSCRIPTION_MODEL
from live_interviews.usage import LiveUsageTotals
from tests.test_live_interview_agent import FakeRails, realtime_usage

OPENING = ReportPromptAsked(question_position=0, kind="opening", text="Tell me about a project.")
ANSWER = ReportAnswerFinished(prompt_message_id="opening-0", transcript="I rebuilt the scheduler.")
FOLLOW_UP = ReportPromptAsked(question_position=0, kind="follow_up", text="What changed?", prompt_key="q0-r0-f1")


class Harness:
    """A reporter plus what it told the controller; `raise_on` maps an event to the reports it raises."""

    def __init__(self, rails=None, raise_on=None):
        self.rails, self.events, self.usage, self.raise_on = rails or FakeRails(), [], [], raise_on or {}

        async def on_event(event):
            self.events.append(event)
            return list(self.raise_on.get(event, []))

        self.reporter = LiveReporter(self.rails, "live", on_event=on_event, usage_totals=lambda: LiveUsageTotals.from_model_usage(
            self.usage, realtime_model=REALTIME_MODEL, transcription_model=TRANSCRIPTION_MODEL),
            server_error_delays=(0, 0))

    def calls(self, name=None):
        return [call[2] if name else call for call in self.rails.calls if name is None or call[0] == name]


def run(coroutine):
    return asyncio.run(coroutine)


def test_reports_are_sent_in_order_and_a_lost_one_is_resent_unchanged_before_newer_ones():
    harness = Harness()
    harness.rails.lose["answer_finished"] = 1

    async def scenario():
        await harness.reporter.send(ANSWER)  # Rails may or may not have saved it
        await harness.reporter.send(FOLLOW_UP)  # needs the answer first

    run(scenario())
    answer = ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."})
    assert harness.calls() == [answer, answer, ("prompt_asked", "live", {
        "question_position": 0, "kind": "follow_up", "text": "What changed?", "prompt_key": "q0-r0-f1"})]


def test_a_prompt_receipt_reaches_the_controller_and_the_answer_it_raises_goes_before_later_reports():
    receipt = PromptRecorded(question_position=0, message_id="opening-0")
    harness = Harness(raise_on={receipt: [ANSWER]})
    harness.rails.lose["prompt_asked"] = 1

    async def scenario():
        await harness.reporter.send(OPENING)  # lost: the receipt has not arrived
        await harness.reporter.send(ReportQuestionAdvanced(question_position=0))

    run(scenario())
    assert harness.events == [receipt]
    assert [call[0] for call in harness.calls()] == ["prompt_asked", "prompt_asked", "answer_finished",
                                                     "question_advanced"]


def test_an_answer_rails_refused_is_dropped_and_reported_back_as_not_saved():
    harness = Harness()
    harness.rails.refuse_reports.add("answer_finished")

    async def scenario():
        await harness.reporter.send(ANSWER)
        await harness.reporter.flush()

    run(scenario())
    assert harness.events == [AnswerNotSaved("opening-0", "I rebuilt the scheduler.")]
    assert len(harness.calls("answer_finished")) == 1  # never resent on its own


def test_a_prompt_rails_refused_is_dropped_and_reported_back_as_not_saved():
    harness = Harness()
    harness.rails.refuse_reports.add("prompt_asked")  # e.g. "No more follow-ups for this question"

    async def scenario():
        await harness.reporter.send(FOLLOW_UP)
        await harness.reporter.flush()

    run(scenario())
    assert harness.events == [PromptNotSaved(question_position=0, prompt_key="q0-r0-f1")]
    assert len(harness.calls("prompt_asked")) == 1  # never resent on its own


def failing_question_advanced(harness, failures, status=503):
    """Rails answers `question_advanced` with `status` the first `failures` times."""
    remaining = [failures]

    async def question_advanced(connection_id, **values):
        harness.rails.calls.append(("question_advanced", connection_id, values))
        if remaining[0]:
            remaining[0] -= 1
            raise RailsClientError(status, None)
        return {"current_question_position": values["question_position"] + 1, "revision": 4}

    harness.rails.question_advanced = question_advanced


def test_a_report_rails_could_not_save_for_a_moment_is_retried_after_a_short_wait():
    """A 5xx (such as Rails' 503 after a database wait: rolled back, retry the same request) is not
    a refusal: the report is sent again unchanged, a few times with a short wait in between."""
    harness = Harness()
    failing_question_advanced(harness, failures=2)

    run(harness.reporter.send(ReportQuestionAdvanced(question_position=0)))
    assert harness.calls("question_advanced") == [{"question_position": 0}] * 3
    assert harness.events == []


def test_a_report_rails_keeps_failing_on_stays_first_and_is_resent_with_the_next_delivery():
    harness = Harness()
    failing_question_advanced(harness, failures=4)

    async def scenario():
        await harness.reporter.send(ReportQuestionAdvanced(question_position=0))  # three tries, all 503
        await harness.reporter.send(OPENING)  # the advance goes first, then this opening

    run(scenario())
    assert [call[0] for call in harness.calls()] == ["question_advanced"] * 5 + ["prompt_asked"]
    assert harness.events == [PromptRecorded(question_position=0, message_id="opening-0")]


def test_a_report_rails_refuses_as_stale_is_still_dropped_at_once():
    harness = Harness()
    harness.rails.refuse_reports.add("feedback_given")

    async def scenario():
        await harness.reporter.send(ReportFeedbackGiven(question_position=0, text="Good structure."))
        await harness.reporter.send(OPENING)

    run(scenario())
    assert len(harness.calls("feedback_given")) == 1  # lost feedback words only: logged, nothing else changes
    assert harness.events == [PromptRecorded(question_position=0, message_id="opening-0")]


@pytest.mark.parametrize("status", [422, 500])
@pytest.mark.parametrize("report", [ReportQuestionAdvanced(question_position=0),
                                    ReportQuestionRetried(question_position=0, retry_number=1)])
def test_a_move_rails_refuses_puts_the_agent_out_of_step_so_nothing_after_it_is_sent(status, report):
    """Rails answers a replayed advance or retry with success, so a refusal (or an unhandled error)
    means Rails stayed where it was: every later report would be refused as no longer current."""
    harness = Harness()
    name = "question_advanced" if isinstance(report, ReportQuestionAdvanced) else "question_retried"

    async def refuse(connection_id, **values):
        harness.rails.calls.append((name, connection_id, values))
        raise RailsClientError(status, None)

    setattr(harness.rails, name, refuse)

    async def scenario():
        await harness.reporter.send(report)
        await harness.reporter.send(OPENING)
        await harness.reporter.heartbeat(SendHeartbeat(1, 30))
        return await harness.reporter.finish(ReportFinish("failed", final_sequence=2))

    assert run(scenario()) is True
    assert harness.events == [ProgressNotSaved(question_position=0)]
    assert [call[0] for call in harness.calls() if call[0] != name] == ["heartbeat", "finish"]


class CurrentQuestionRails(FakeRails):
    """Rails that keeps the current question and refuses reports for any other, as the real services
    do ("Question is no longer current"); an advance answers 503 (rolled back) the first `busy` times."""

    def __init__(self, busy=0):
        super().__init__()
        self.current, self.busy = 0, busy

    def _check(self, position):
        if position != self.current:
            raise RailsClientError(422, None)

    async def question_advanced(self, connection_id, **values):
        self.calls.append(("question_advanced", connection_id, values))
        if self.busy:
            self.busy -= 1
            raise RailsClientError(503, None)
        if values["question_position"] == self.current - 1:  # a replay of the move just made
            return {"current_question_position": self.current, "revision": 4}
        self._check(values["question_position"])
        self.current += 1
        return {"current_question_position": self.current, "revision": 4}

    async def prompt_asked(self, connection_id, **values):
        self._check(values["question_position"])
        return await super().prompt_asked(connection_id, **values)

    async def feedback_given(self, connection_id, **values):
        self._check(values["question_position"])
        return await super().feedback_given(connection_id, **values)


def test_an_advance_rails_keeps_answering_with_a_503_is_never_dropped_so_later_reports_stay_in_step():
    rounds = MAX_BUSY_ROUNDS + 2
    harness = Harness(rails=CurrentQuestionRails(busy=3 * rounds))
    next_opening = ReportPromptAsked(question_position=1, kind="opening", text="Tell me about a conflict.")

    async def scenario():
        await harness.reporter.send(ReportQuestionAdvanced(question_position=0))
        for _ in range(rounds - 1):
            await harness.reporter.heartbeat(SendHeartbeat(len(harness.calls("heartbeat")) + 1, 30))
        await harness.reporter.send(next_opening)  # the advance finally goes through first

    run(scenario())
    assert harness.calls("question_advanced") == [{"question_position": 0}] * (3 * rounds + 1)
    assert len(harness.calls("heartbeat")) == rounds - 1  # heartbeats are not held up by it
    assert harness.events == [PromptRecorded(question_position=1, message_id="opening-1")]


def test_connection_ended_stops_everything_and_is_reported_once():
    harness = Harness()
    harness.rails.ended = True

    async def scenario():
        await harness.reporter.send(OPENING)
        await harness.reporter.send(ANSWER)
        assert await harness.reporter.heartbeat(SendHeartbeat(sequence=1, billed_seconds_delta=30)) is None
        assert await harness.reporter.finish(ReportFinish("completed", final_sequence=1)) is False

    run(scenario())
    assert harness.reporter.ended and harness.events == [ConnectionEnded()]
    assert [call[0] for call in harness.calls()] == ["prompt_asked", "finish"]


def test_finish_retries_lost_reports_first_and_says_whether_rails_accepted_it():
    harness = Harness()
    harness.rails.lose["question_advanced"] = 1

    async def scenario():
        await harness.reporter.send(ReportQuestionAdvanced(question_position=0))
        accepted = await harness.reporter.finish(ReportFinish("completed", final_sequence=2))
        harness.rails.refuse_finish = True
        return accepted, await harness.reporter.finish(ReportFinish("completed"))

    assert run(scenario()) == (True, False)
    assert [call[0] for call in harness.calls()] == ["question_advanced", "question_advanced", "finish", "finish"]


def test_heartbeats_report_counted_seconds_and_new_usage_and_resend_a_lost_one_unchanged():
    harness = Harness()

    async def scenario():
        harness.usage = [realtime_usage(1_000)]
        assert await harness.reporter.heartbeat(SendHeartbeat(1, 30)) == harness.rails.heartbeat_reply
        harness.rails.refuse_heartbeat = True  # Rails may have applied it; only the reply is lost
        harness.usage = [realtime_usage(1_500)]
        assert await harness.reporter.heartbeat(SendHeartbeat(2, 30)) is None
        harness.rails.refuse_heartbeat = False
        await harness.reporter.heartbeat(SendHeartbeat(3, 10))

    run(scenario())
    entry = {"model": "gpt-realtime-2.1-mini", "cached_input_tokens": 0, "output_tokens": 0}
    lost = {"sequence": 2, "billed_seconds_delta": 30, "usage": [{**entry, "input_tokens": 500, "cost_microdollars": 5_000}]}
    assert harness.calls("heartbeat") == [
        {"sequence": 1, "billed_seconds_delta": 30, "usage": [{**entry, "input_tokens": 1_000, "cost_microdollars": 10_000}]},
        lost,
        lost,  # resent unchanged, so Rails replays it if it was applied
        {"sequence": 3, "billed_seconds_delta": 10, "usage": []},
    ]


def test_a_heartbeat_lost_twice_holds_back_newer_seconds_until_rails_answers():
    harness = Harness()
    harness.rails.refuse_heartbeat = True

    async def scenario():
        await harness.reporter.heartbeat(SendHeartbeat(1, 30))
        await harness.reporter.heartbeat(SendHeartbeat(2, 30))  # the resend is lost too; the new 30 seconds wait
        harness.rails.refuse_heartbeat = False
        await harness.reporter.heartbeat(SendHeartbeat(3, 5))

    run(scenario())
    first = {"sequence": 1, "billed_seconds_delta": 30, "usage": []}
    assert harness.calls("heartbeat") == [first, first, first, {"sequence": 3, "billed_seconds_delta": 35, "usage": []}]


def test_a_heartbeat_refused_outright_is_not_resent_and_its_seconds_go_with_the_next():
    harness = Harness()
    harness.rails.heartbeat_error = RailsClientError(409, None)  # a definite no: nothing was applied

    async def scenario():
        assert await harness.reporter.heartbeat(SendHeartbeat(1, 30)) is None
        harness.rails.heartbeat_error = None
        await harness.reporter.heartbeat(SendHeartbeat(2, 10))

    run(scenario())
    assert harness.calls("heartbeat") == [{"sequence": 1, "billed_seconds_delta": 30, "usage": []},
                                          {"sequence": 2, "billed_seconds_delta": 40, "usage": []}]


def test_a_heartbeat_waits_for_lost_reports_to_be_resent_first():
    harness = Harness()
    harness.rails.lose["prompt_asked"] = 1

    async def scenario():
        await harness.reporter.send(OPENING)
        await harness.reporter.heartbeat(SendHeartbeat(1, 0))

    run(scenario())
    assert [call[0] for call in harness.calls()] == ["prompt_asked", "prompt_asked", "heartbeat"]


@pytest.mark.parametrize(("status", "code"), [(409, "unknown_usage_model"), (422, "invalid_request")])
def test_a_heartbeat_refused_as_a_bug_is_logged_as_an_error_with_its_code_and_not_resent(caplog, status, code):
    """An unbilled model or a malformed request is refused every time: a bug, not a stale report."""
    harness = Harness()
    harness.rails.heartbeat_error = RailsClientError(status, code)
    with caplog.at_level("ERROR", logger="live_interviews.reporter"):
        assert run(harness.reporter.heartbeat(SendHeartbeat(1, 30))) is None
    errors = [record for record in caplog.records if record.levelname == "ERROR"]
    assert len(errors) == 1 and code in errors[0].getMessage()
    harness.rails.heartbeat_error = None
    run(harness.reporter.heartbeat(SendHeartbeat(2, 30)))
    assert [call["sequence"] for call in harness.calls("heartbeat")] == [1, 2]  # a definite no: never resent


def test_a_reply_names_the_action_rails_wants():
    harness = Harness()
    harness.rails.heartbeat_reply = HeartbeatReply(action="wrap_up", reason="allowance",
                                                   session_seconds_left=900)
    assert run(harness.reporter.heartbeat(SendHeartbeat(1, 30))).action == "wrap_up"


def test_a_finish_refused_as_connection_ended_marks_the_connection_ended():
    """Rails answers a finish for an ended connection or a no-longer-active session with `connection_ended`."""
    harness = Harness()

    async def finish_ended(connection_id, **values):
        harness.rails.calls.append(("finish", connection_id, values))
        raise LiveConnectionEnded(409, "connection_ended")

    harness.rails.finish = finish_ended
    assert run(harness.reporter.finish(ReportFinish("ended_by_candidate", final_sequence=1))) is False
    assert harness.reporter.ended and harness.events == [ConnectionEnded()]


def test_a_report_rails_keeps_answering_with_a_500_is_dropped_as_a_bug_and_later_reports_still_arrive(caplog):
    """Only a 503 means "rolled back, send it again"; another 5xx (an unhandled error) is not resent."""
    harness = Harness()

    async def answer_finished(connection_id, **values):
        harness.rails.calls.append(("answer_finished", connection_id, values))
        raise RailsClientError(500, None)

    harness.rails.answer_finished = answer_finished

    async def scenario():
        await harness.reporter.send(ANSWER)
        await harness.reporter.send(FOLLOW_UP)
        await harness.reporter.heartbeat(SendHeartbeat(1, 30))

    with caplog.at_level("ERROR", logger="live_interviews.reporter"):
        run(scenario())
    assert len(harness.calls("answer_finished")) == 3  # one round: the first try and two retries
    assert harness.events == [AnswerNotSaved("opening-0", "I rebuilt the scheduler."),
                              PromptRecorded(question_position=0, message_id="follow_up-0", prompt_key="q0-r0-f1")]
    assert [call[0] for call in harness.calls()][3:] == ["prompt_asked", "heartbeat"]
    assert any(record.levelname == "ERROR" and "500" in record.getMessage() for record in caplog.records)


def test_a_prompt_rails_keeps_answering_with_a_503_is_dropped_after_a_bounded_number_of_rounds(caplog):
    """A prompt whose loss the controller handles (`PromptNotSaved`) may be dropped after the cap."""
    harness = Harness()

    async def prompt_asked(connection_id, **values):
        harness.rails.calls.append(("prompt_asked", connection_id, values))
        raise RailsClientError(503, None)

    harness.rails.prompt_asked = prompt_asked

    async def scenario():
        await harness.reporter.send(OPENING)
        for _ in range(MAX_BUSY_ROUNDS - 1):
            await harness.reporter.flush()
        await harness.reporter.send(ReportQuestionAdvanced(question_position=0))

    with caplog.at_level("ERROR", logger="live_interviews.reporter"):
        run(scenario())
    assert [call[0] for call in harness.calls()] == ["prompt_asked"] * 3 * MAX_BUSY_ROUNDS + ["question_advanced"]
    assert harness.events == [PromptNotSaved(question_position=0)]
    assert any(record.levelname == "ERROR" for record in caplog.records)


def test_a_heartbeat_rails_answers_with_a_500_is_not_resent_and_its_seconds_go_with_the_next():
    harness = Harness()
    harness.rails.heartbeat_error = RailsClientError(500, None)

    async def scenario():
        assert await harness.reporter.heartbeat(SendHeartbeat(1, 30)) is None
        harness.rails.heartbeat_error = None
        return await harness.reporter.heartbeat(SendHeartbeat(2, 10))

    assert run(scenario()) == harness.rails.heartbeat_reply  # a reply (say, wrap up) still arrives
    assert harness.calls("heartbeat") == [{"sequence": 1, "billed_seconds_delta": 30, "usage": []}] * 3 + [
        {"sequence": 2, "billed_seconds_delta": 40, "usage": []}]


def test_a_heartbeat_rails_keeps_answering_with_a_503_is_dropped_after_the_cap_and_newer_ones_get_through():
    harness = Harness()
    harness.rails.heartbeat_error = RailsClientError(503, None)  # rolled back each time: never applied

    async def scenario():
        for sequence in range(1, MAX_BUSY_ROUNDS + 1):
            assert await harness.reporter.heartbeat(SendHeartbeat(sequence, 30)) is None
        harness.rails.heartbeat_error = None
        return await harness.reporter.heartbeat(SendHeartbeat(MAX_BUSY_ROUNDS + 1, 5))

    assert run(scenario()) == harness.rails.heartbeat_reply
    sent = harness.calls("heartbeat")
    # The first is resent each round until the cap, then dropped; the next one is sent at once (and lost too).
    assert [call["sequence"] for call in sent] == [1] * 3 * MAX_BUSY_ROUNDS + [MAX_BUSY_ROUNDS] * 4 + [
        MAX_BUSY_ROUNDS + 1]
    # No counted second is lost: the dropped one's seconds went with the next heartbeat.
    assert [call["billed_seconds_delta"] for call in sent[-2:]] == [30 * MAX_BUSY_ROUNDS, 5]
