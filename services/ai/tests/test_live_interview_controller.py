"""Drive the live interview controller through its event -> actions interface (no LiveKit)."""

import subprocess
import sys
from pathlib import Path

from live_interviews.controller import (
    AskFollowUp,
    CandidateTurnFinished,
    EndRequested,
    EndSession,
    FinishAnswer,
    GenerateReply,
    InterviewerTurnFinished,
    LiveInterviewController,
    NextQuestion,
    PromptRecorded,
    PublishRoomState,
    RepeatQuestion,
    ReportAnswerFinished,
    ReportFinish,
    ReportPromptAsked,
    ReportQuestionAdvanced,
    Started,
    ToolResult,
)


def started_controller(position=0, total=5, answer_cap=2):
    controller = LiveInterviewController()
    actions = controller.handle(Started(question_position=position, question_total=total, answer_cap=answer_cap))
    return controller, actions


def asked_and_recorded(controller, position=0, message_id="opening-0"):
    """The interviewer asks the current question and Rails saves it as `message_id`."""
    controller.handle(InterviewerTurnFinished(text="Tell me about a project."))
    assert controller.handle(PromptRecorded(question_position=position, message_id=message_id)) == []


def tool_text(actions):
    results = [action for action in actions if isinstance(action, ToolResult)]
    assert len(results) == 1 and actions[-1] is results[0]
    return results[0].text


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
    controller.handle(Started(question_position=0, question_total=5, answer_cap=2))
    assert controller.handle(InterviewerTurnFinished(text="   ")) == []
    assert controller.handle(InterviewerTurnFinished(text="Question one?"))[0] == ReportPromptAsked(
        question_position=0, kind="opening", text="Question one?"
    )


def test_a_repeated_start_does_not_greet_twice():
    controller, _ = started_controller()
    assert controller.handle(Started(question_position=0, question_total=5, answer_cap=2)) == []


def test_the_controller_loads_without_livekit_openai_or_http_clients():
    probe = ("import sys, live_interviews.controller; "
             "print(sorted(m for m in ('livekit', 'openai', 'httpx', 'aiohttp') if m in sys.modules))")
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, check=True,
                            cwd=Path(__file__).resolve().parents[1])
    assert result.stdout.strip() == "[]"


def test_candidate_pieces_are_saved_together_when_the_answer_is_finished():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text=" I rebuilt the lab scheduler. "))
    controller.handle(CandidateTurnFinished(text="   "))
    controller.handle(CandidateTurnFinished(text="It cut missed runs in half."))
    actions = controller.handle(FinishAnswer())
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0",
                                              transcript="I rebuilt the lab scheduler. It cut missed runs in half.")
    assert "next_question" in tool_text(actions)
    assert controller.handle(FinishAnswer())[:-1] == []  # nothing new to save


def test_candidate_speech_while_the_question_is_being_asked_is_not_an_answer():
    controller, _ = started_controller()
    controller.handle(CandidateTurnFinished(text="Sorry, could you say that again?"))
    asked_and_recorded(controller)
    assert "not answered" in tool_text(controller.handle(FinishAnswer())).lower()


def test_a_follow_up_is_refused_before_any_answer():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    actions = controller.handle(AskFollowUp(question_text="What changed?"))
    assert len(actions) == 1
    assert "not answered" in tool_text(actions).lower()


def test_an_accepted_follow_up_saves_the_answer_and_reports_the_spoken_follow_up():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    actions = controller.handle(AskFollowUp(question_text="What changed?"))
    assert actions[:2] == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="I rebuilt the scheduler."),
        PublishRoomState(question_position=0, question_total=5, phase="asking"),
    ]
    assert "ask" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Nice. What changed for the team?")) == [
        ReportPromptAsked(question_position=0, kind="follow_up", text="Nice. What changed for the team?"),
        PublishRoomState(question_position=0, question_total=5, phase="answering"),
    ]
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1"))
    controller.handle(CandidateTurnFinished(text="Fewer failed runs."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="follow-1",
                                                                        transcript="Fewer failed runs.")


def test_follow_ups_stop_at_the_answer_cap():
    controller, _ = started_controller(answer_cap=2)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="First answer."))
    controller.handle(AskFollowUp(question_text="Why?"))
    controller.handle(InterviewerTurnFinished(text="Why did that work?"))
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1"))
    controller.handle(CandidateTurnFinished(text="Because we measured it."))
    actions = controller.handle(AskFollowUp(question_text="Anything else?"))
    assert len(actions) == 1
    assert "next_question" in tool_text(actions)
    # The pending answer still saves when the interviewer moves on.
    assert controller.handle(NextQuestion())[0] == ReportAnswerFinished(prompt_message_id="follow-1",
                                                                        transcript="Because we measured it.")


def test_a_cap_of_one_allows_no_follow_up():
    controller, _ = started_controller(answer_cap=1)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    assert "next_question" in tool_text(controller.handle(AskFollowUp(question_text="Why?")))


def test_more_words_after_a_saved_answer_replace_it_without_counting_twice():
    controller, _ = started_controller(answer_cap=2)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="Short answer."))
    controller.handle(FinishAnswer())
    controller.handle(CandidateTurnFinished(text="Actually, one more detail."))
    actions = controller.handle(AskFollowUp(question_text="Go on?"))
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0",
                                              transcript="Short answer. Actually, one more detail.")
    assert any(isinstance(action, PublishRoomState) and action.phase == "asking" for action in actions)


def test_repeat_question_asks_again_without_saving_anything():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    actions = controller.handle(RepeatQuestion())
    assert len(actions) == 1
    assert "repeat" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Sure: tell me about a project.")) == []


def test_next_question_saves_the_answer_advances_and_asks_the_next_opening():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    actions = controller.handle(NextQuestion())
    assert actions[:3] == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer."),
        ReportQuestionAdvanced(question_position=0),
        PublishRoomState(question_position=1, question_total=5, phase="asking"),
    ]
    assert "question 2" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Next: how do you handle conflict?"))[0] == ReportPromptAsked(
        question_position=1, kind="opening", text="Next: how do you handle conflict?")
    # A late receipt for the old question cannot become the new prompt.
    controller.handle(PromptRecorded(question_position=0, message_id="opening-0"))
    controller.handle(CandidateTurnFinished(text="Calmly."))
    assert controller.handle(FinishAnswer())[0] != ReportAnswerFinished(prompt_message_id="opening-0", transcript="Calmly.")


def test_moving_on_without_an_answer_reports_only_the_advance():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    actions = controller.handle(NextQuestion())
    assert actions[0] == ReportQuestionAdvanced(question_position=0)


def test_the_last_question_closes_warmly_then_finishes_and_ends():
    controller, _ = started_controller(position=4, total=5)
    asked_and_recorded(controller, position=4, message_id="opening-4")
    controller.handle(CandidateTurnFinished(text="Final answer."))
    actions = controller.handle(NextQuestion())
    assert actions[:3] == [
        ReportAnswerFinished(prompt_message_id="opening-4", transcript="Final answer."),
        ReportQuestionAdvanced(question_position=4),
        PublishRoomState(question_position=4, question_total=5, phase="closing"),
    ]
    assert "thank" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Thanks so much, that's the end. Goodbye!")) == [
        ReportFinish(reason="completed"),
        PublishRoomState(question_position=4, question_total=5, phase="ended"),
        EndSession(),
    ]
    assert controller.handle(InterviewerTurnFinished(text="Bye.")) == []
    assert controller.handle(EndRequested()) == []
    assert "ended" in tool_text(controller.handle(NextQuestion())).lower()


def test_end_requested_saves_the_pending_answer_then_finishes_for_the_candidate():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="Partial answer."))
    assert controller.handle(EndRequested()) == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="Partial answer."),
        ReportFinish(reason="ended_by_candidate"),
        PublishRoomState(question_position=0, question_total=5, phase="ended"),
        EndSession(),
    ]
    assert controller.handle(EndRequested()) == []
    assert controller.handle(CandidateTurnFinished(text="More.")) == []


def test_tool_calls_before_the_interview_starts_are_refused():
    controller = LiveInterviewController()
    assert "not started" in tool_text(controller.handle(NextQuestion())).lower()
