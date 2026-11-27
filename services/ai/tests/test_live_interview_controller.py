"""Drive the live interview controller through its event -> actions interface (no LiveKit)."""

import subprocess
import sys
from pathlib import Path

from live_interviews.controller import (
    GenerateReply,
    InterviewerTurnFinished,
    LiveInterviewController,
    PublishRoomState,
    ReportPromptAsked,
    Started,
)


def started_controller(position=0, total=5):
    controller = LiveInterviewController()
    actions = controller.handle(Started(question_position=position, question_total=total))
    return controller, actions


def test_start_publishes_progress_and_asks_for_a_greeting_and_the_current_question():
    _controller, actions = started_controller()
    assert actions[0] == PublishRoomState(question_position=0, question_total=5, phase="asking")
    assert len(actions) == 2
    reply = actions[1]
    assert isinstance(reply, GenerateReply)
    assert "greet" in reply.instructions.lower()
    assert "question 1" in reply.instructions.lower()


def test_start_asks_the_question_rails_says_is_current():
    _controller, actions = started_controller(position=2, total=8)
    assert actions[0] == PublishRoomState(question_position=2, question_total=8, phase="asking")
    assert "question 3" in actions[1].instructions.lower()


def test_the_first_interviewer_turn_is_reported_once_as_the_opening():
    controller, _ = started_controller()
    spoken = "Hi, I'm glad you're here. Tell me about a project you're proud of."
    assert controller.handle(InterviewerTurnFinished(text=f"  {spoken} ")) == [
        ReportPromptAsked(question_position=0, kind="opening", text=spoken),
        PublishRoomState(question_position=0, question_total=5, phase="answering"),
    ]
    assert controller.handle(InterviewerTurnFinished(text="Take your time.")) == []


def test_blank_turns_and_turns_before_start_are_ignored():
    controller = LiveInterviewController()
    assert controller.handle(InterviewerTurnFinished(text="Hello")) == []
    controller.handle(Started(question_position=0, question_total=5))
    assert controller.handle(InterviewerTurnFinished(text="   ")) == []
    assert controller.handle(InterviewerTurnFinished(text="Question one?"))[0] == ReportPromptAsked(
        question_position=0, kind="opening", text="Question one?"
    )


def test_a_repeated_start_does_not_greet_twice():
    controller, _ = started_controller()
    assert controller.handle(Started(question_position=0, question_total=5)) == []


def test_the_controller_loads_without_livekit_openai_or_http_clients():
    probe = ("import sys, live_interviews.controller; "
             "print(sorted(m for m in ('livekit', 'openai', 'httpx', 'aiohttp') if m in sys.modules))")
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True,
                            cwd=Path(__file__).resolve().parents[1])
    assert result.stdout.strip() == "[]"
