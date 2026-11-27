"""Drive the live interview controller through its event -> actions interface (no LiveKit)."""

import subprocess
import sys
from pathlib import Path

from live_interviews.controller import (
    NO_FEEDBACK_AFTER_RECONNECT,
    AnswerNotSaved,
    AskFollowUp,
    CandidateJoined,
    CandidateLeft,
    CandidateTurnFinished,
    ClosingSpoken,
    ConnectionEnded,
    EndRequested,
    EndSession,
    FinishAnswer,
    GenerateReply,
    GiveFeedback,
    GiveHint,
    HeartbeatDue,
    HeartbeatReplied,
    InterviewerTurnFinished,
    LiveInterviewController,
    MenuChoice,
    NextQuestion,
    OfferMenu,
    PromptRecorded,
    PublishRoomState,
    RepeatQuestion,
    ReportAnswerFinished,
    ReportFeedbackGiven,
    ReportFinish,
    ReportPromptAsked,
    ReportQuestionAdvanced,
    ReportQuestionRetried,
    RetryQuestion,
    SayClosing,
    SendHeartbeat,
    SpeakingChanged,
    Started,
    Tick,
    ToolResult,
)


def started_controller(position=0, total=5, answer_cap=2):
    controller = LiveInterviewController()
    actions = controller.handle(Started(question_position=position, question_total=total, answer_cap=answer_cap,
                                         session_seconds_left=1_500))
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
    assert actions[0] == PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="asking")
    assert len(actions) == 2
    reply = actions[1]
    assert isinstance(reply, GenerateReply)
    assert "greet" in reply.instructions.lower()
    assert "question 1" in reply.instructions.lower()


def test_start_asks_the_question_rails_says_is_current():
    _controller, actions = started_controller(position=2, total=8)
    assert actions[0] == PublishRoomState(seconds_left=1_500, question_position=2, question_total=8, phase="asking")
    assert "question 3" in actions[1].instructions.lower()


def test_the_first_interviewer_turn_is_reported_once_as_the_opening():
    controller, _ = started_controller()
    spoken = "Hi, I'm glad you're here. Tell me about a project you're proud of."
    assert controller.handle(InterviewerTurnFinished(text=f"  {spoken} ")) == [
        ReportPromptAsked(question_position=0, kind="opening", text=spoken),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="answering"),
    ]
    assert controller.handle(InterviewerTurnFinished(text="Take your time.")) == []


def test_blank_turns_and_turns_before_start_are_ignored():
    controller = LiveInterviewController()
    assert controller.handle(InterviewerTurnFinished(text="Hello")) == []
    controller.handle(Started(question_position=0, question_total=5, answer_cap=2, session_seconds_left=1_500))
    assert controller.handle(InterviewerTurnFinished(text="   ")) == []
    assert controller.handle(InterviewerTurnFinished(text="Question one?"))[0] == ReportPromptAsked(
        question_position=0, kind="opening", text="Question one?"
    )


def test_a_repeated_start_does_not_greet_twice():
    controller, _ = started_controller()
    assert controller.handle(Started(question_position=0, question_total=5, answer_cap=2, session_seconds_left=1_500)) == []


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


def test_a_transcript_the_adapter_stopped_waiting_for_is_never_saved_to_the_next_prompt():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    controller.handle(AskFollowUp(question_text="What changed?"))
    controller.handle(CandidateTurnFinished(text="Late words from the first answer."))  # while the follow-up is asked
    controller.handle(InterviewerTurnFinished(text="What changed for the team?"))
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1", prompt_key="q0-r0-f1"))
    controller.handle(CandidateTurnFinished(text="Fewer failed runs."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="follow-1",
                                                                        transcript="Fewer failed runs.")


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
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="asking"),
    ]
    assert "ask" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Nice. What changed for the team?")) == [
        ReportPromptAsked(question_position=0, kind="follow_up", text="Nice. What changed for the team?",
                          prompt_key="q0-r0-f1"),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="answering"),
    ]
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1", prompt_key="q0-r0-f1"))
    controller.handle(CandidateTurnFinished(text="Fewer failed runs."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="follow-1",
                                                                        transcript="Fewer failed runs.")


def test_follow_ups_stop_at_the_answer_cap_and_the_question_goes_to_feedback():
    controller, _ = started_controller(answer_cap=2)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="First answer."))
    controller.handle(AskFollowUp(question_text="Why?"))
    controller.handle(InterviewerTurnFinished(text="Why did that work?"))
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1", prompt_key="q0-r0-f1"))
    controller.handle(CandidateTurnFinished(text="Because we measured it."))
    actions = controller.handle(AskFollowUp(question_text="Anything else?"))
    # The pending answer still saves, and no third prompt is asked.
    assert actions[0] == ReportAnswerFinished(prompt_message_id="follow-1", transcript="Because we measured it.")
    assert not any(isinstance(action, ReportPromptAsked) for action in actions)
    assert "Quick feedback:" in tool_text(actions)


def test_finishing_the_last_allowed_answer_goes_to_feedback():
    controller, _ = started_controller(answer_cap=1)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    actions = controller.handle(FinishAnswer())
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    assert "Quick feedback:" in tool_text(actions)


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


def test_choosing_next_from_the_menu_advances_and_asks_the_next_opening():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    assert controller.handle(NextQuestion())[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    controller.handle(InterviewerTurnFinished(text="Quick feedback: good. Add a number."))
    actions = controller.handle(NextQuestion())
    assert actions[:2] == [
        ReportQuestionAdvanced(question_position=0),
        PublishRoomState(seconds_left=1_500, question_position=1, question_total=5, phase="asking"),
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
    controller = menu_controller(position=4)
    actions = controller.handle(NextQuestion())
    assert actions[:2] == [
        ReportQuestionAdvanced(question_position=4),
        PublishRoomState(seconds_left=1_500, question_position=4, question_total=5, phase="closing"),
    ]
    assert "thank" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="Thanks so much, that's the end. Goodbye!")) == [
        SendHeartbeat(sequence=1, billed_seconds_delta=0, final=True),
        ReportFinish(reason="completed", final_sequence=1),
        PublishRoomState(seconds_left=1_500, question_position=4, question_total=5, phase="ended"),
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
        SendHeartbeat(sequence=1, billed_seconds_delta=0, final=True),
        ReportFinish(reason="ended_by_candidate", final_sequence=1),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="ended"),
        EndSession(),
    ]
    assert controller.handle(EndRequested()) == []
    assert controller.handle(CandidateTurnFinished(text="More.")) == []


def test_rails_ending_the_connection_leaves_at_once_without_saving_or_finishing_again():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(Tick(now=0.0))
    controller.handle(CandidateTurnFinished(text="Partial answer."))
    controller.handle(Tick(now=20.0))
    assert controller.handle(ConnectionEnded()) == [EndSession()]
    assert controller.handle(ConnectionEnded()) == []
    assert controller.handle(HeartbeatDue()) == []
    assert controller.handle(Tick(now=500.0)) == []
    assert controller.handle(EndRequested()) == []
    assert "ended" in tool_text(controller.handle(NextQuestion())).lower()


def test_rails_ending_the_connection_while_the_candidate_is_away_still_leaves():
    controller, _ = started_controller()
    controller.handle(CandidateLeft(now=0.0))
    assert controller.handle(ConnectionEnded()) == [EndSession()]


def test_tool_calls_before_the_interview_starts_are_refused():
    controller = LiveInterviewController()
    assert "not started" in tool_text(controller.handle(NextQuestion())).lower()


# The coaching loop: feedback after each question, then a menu the candidate chooses from.

def menu_controller(position=0, total=5, answer_cap=2):
    """A controller whose current question was answered, given feedback and is now at the menu."""
    controller, _ = started_controller(position=position, total=total, answer_cap=answer_cap)
    asked_and_recorded(controller, position=position, message_id=f"opening-{position}")
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    controller.handle(InterviewerTurnFinished(text="Quick feedback: clear example. Lead with the result."))
    return controller


def test_moving_on_from_an_answered_question_gives_quick_feedback_before_advancing():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    actions = controller.handle(NextQuestion())
    assert actions[:2] == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer."),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="feedback"),
    ]
    assert not any(isinstance(action, ReportQuestionAdvanced) for action in actions)
    text = tool_text(actions)
    assert "Quick feedback:" in text and "strength" in text and "fix" in text


def test_the_spoken_feedback_is_saved_then_the_menu_is_offered_and_published():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    actions = controller.handle(InterviewerTurnFinished(text=" Quick feedback: clear example. Lead with the result. "))
    assert actions[:2] == [
        ReportFeedbackGiven(question_position=0, text="Quick feedback: clear example. Lead with the result."),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="menu", menu_offered=True),
    ]
    assert isinstance(actions[2], GenerateReply) and len(actions) == 3
    menu = actions[2].instructions.lower()
    assert all(choice in menu for choice in ("try", "hear the question again", "hint", "move on"))


def test_the_follow_up_cap_leads_straight_to_feedback():
    controller, _ = started_controller(answer_cap=1)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    actions = controller.handle(AskFollowUp(question_text="Why?"))
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    assert actions[1] == PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="feedback")
    assert "Quick feedback:" in tool_text(actions)


def test_a_question_with_no_answer_moves_on_without_feedback():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    actions = controller.handle(NextQuestion())
    assert actions[0] == ReportQuestionAdvanced(question_position=0)


def test_the_menu_never_moves_on_by_itself():
    controller = menu_controller()
    assert controller.handle(InterviewerTurnFinished(text="Take your time to choose.")) == []
    assert controller.handle(CandidateTurnFinished(text="Hmm, let me think.")) == []
    for tool in (AskFollowUp(question_text="Why?"), FinishAnswer()):
        actions = controller.handle(tool)
        assert len(actions) == 1 and "wait for their choice" in tool_text(actions).lower()


def test_how_was_that_mid_answer_gives_feedback_then_returns_to_the_answer():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    actions = controller.handle(GiveFeedback())
    assert actions[:2] == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="I rebuilt the scheduler."),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="feedback"),
    ]
    assert "answer so far" in tool_text(actions)
    assert controller.handle(InterviewerTurnFinished(text="Quick feedback: good start. Say what changed.")) == [
        ReportFeedbackGiven(question_position=0, text="Quick feedback: good start. Say what changed."),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="answering"),
    ]
    controller.handle(CandidateTurnFinished(text="Missed runs halved."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(
        prompt_message_id="opening-0", transcript="I rebuilt the scheduler. Missed runs halved.")


def test_feedback_needs_an_answer_and_waits_while_it_is_being_spoken():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    assert "nothing to give feedback on" in tool_text(controller.handle(GiveFeedback()))
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    for tool in (NextQuestion(), GiveFeedback(), AskFollowUp(question_text="Why?")):
        assert "feedback first" in tool_text(controller.handle(tool))


def test_feedback_from_the_menu_replaces_the_saved_feedback_and_offers_the_menu_again():
    controller = menu_controller()
    actions = controller.handle(GiveFeedback())
    assert actions[0] == PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="feedback")
    assert "Quick feedback:" in tool_text(actions)
    actions = controller.handle(InterviewerTurnFinished(text="Quick feedback: more detail on the result."))
    assert actions[0] == ReportFeedbackGiven(question_position=0, text="Quick feedback: more detail on the result.")
    assert actions[1].menu_offered is True and isinstance(actions[2], GenerateReply)


def test_long_feedback_is_saved_within_the_rails_limit():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    report = controller.handle(InterviewerTurnFinished(text="Quick feedback: " + "very " * 400))[0]
    assert isinstance(report, ReportFeedbackGiven) and len(report.text) <= 1_500


def test_hear_the_question_again_from_the_menu_repeats_it_and_offers_the_menu_again():
    controller = menu_controller()
    actions = controller.handle(RepeatQuestion())
    assert len(actions) == 1
    text = tool_text(actions).lower()
    assert "repeat the core question" in text and "wait for their choice" in text
    assert controller.handle(InterviewerTurnFinished(text="Sure. Tell me about a project.")) == []


def test_try_again_restarts_the_whole_question_and_the_new_attempt_replaces_the_old():
    controller = menu_controller()
    actions = controller.handle(RetryQuestion())
    assert actions[:2] == [
        ReportQuestionRetried(question_position=0, retry_number=1),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="asking"),
    ]
    assert "question 1" in tool_text(actions).lower()
    # Rails returns the saved opening for the re-asked question; the new answer goes to it.
    assert controller.handle(InterviewerTurnFinished(text="Let's try again. Tell me about a project."))[0] == ReportPromptAsked(
        question_position=0, kind="opening", text="Let's try again. Tell me about a project.")
    controller.handle(PromptRecorded(question_position=0, message_id="opening-0"))
    controller.handle(CandidateTurnFinished(text="A sharper answer."))
    actions = controller.handle(AskFollowUp(question_text="What changed?"))
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="A sharper answer.")
    assert "ask" in tool_text(actions).lower()  # the follow-up allowance starts over too


def test_a_third_retry_is_refused_politely_and_the_other_choices_are_offered():
    controller = menu_controller()
    for number in (1, 2):
        assert controller.handle(RetryQuestion())[0] == ReportQuestionRetried(question_position=0, retry_number=number)
        controller.handle(InterviewerTurnFinished(text="Tell me about a project."))
        controller.handle(PromptRecorded(question_position=0, message_id="opening-0"))
        controller.handle(CandidateTurnFinished(text=f"Attempt {number + 1}."))
        controller.handle(NextQuestion())
        controller.handle(InterviewerTurnFinished(text="Quick feedback: better."))
    actions = controller.handle(RetryQuestion())
    assert len(actions) == 1
    text = tool_text(actions).lower()
    assert "both retries" in text and "hint" in text and "move on" in text


def test_retries_already_used_before_a_restart_count_toward_the_limit():
    controller = LiveInterviewController()
    controller.handle(Started(question_position=1, question_total=5, answer_cap=2, session_seconds_left=1_500, retry_count=2))
    asked_and_recorded(controller, position=1, message_id="opening-1")
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    controller.handle(InterviewerTurnFinished(text="Quick feedback: good."))
    assert "both retries" in tool_text(controller.handle(RetryQuestion())).lower()
    controller.handle(NextQuestion())
    controller.handle(InterviewerTurnFinished(text="Next question."))
    controller.handle(PromptRecorded(question_position=2, message_id="opening-2"))
    controller.handle(CandidateTurnFinished(text="Answer two."))
    controller.handle(NextQuestion())
    controller.handle(InterviewerTurnFinished(text="Quick feedback: fine."))
    assert controller.handle(RetryQuestion())[0] == ReportQuestionRetried(question_position=2, retry_number=1)


def test_try_again_while_answering_restarts_without_saving_the_abandoned_words():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="Um, let me start over."))
    actions = controller.handle(RetryQuestion())
    assert not any(isinstance(action, ReportAnswerFinished) for action in actions)
    assert actions[0] == ReportQuestionRetried(question_position=0, retry_number=1)


def test_a_hint_points_to_an_approach_before_answering_and_saves_nothing():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    actions = controller.handle(GiveHint())
    assert len(actions) == 1
    text = tool_text(actions).lower()
    assert "approach" in text and "never" in text and "finished answer" in text
    assert controller.handle(InterviewerTurnFinished(text="Think about a time you measured the result.")) == []
    controller.handle(CandidateTurnFinished(text="My answer."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")


def test_a_hint_from_the_menu_stays_at_the_menu():
    controller = menu_controller()
    actions = controller.handle(GiveHint())
    assert len(actions) == 1
    text = tool_text(actions).lower()
    assert "finished answer" in text and "wait for their choice" in text
    assert controller.handle(InterviewerTurnFinished(text="Try leading with the outcome.")) == []
    assert "wait for their choice" in tool_text(controller.handle(FinishAnswer())).lower()


def test_hints_and_retries_wait_until_the_question_has_been_asked_or_feedback_is_spoken():
    controller, _ = started_controller()
    assert "not been asked" in tool_text(controller.handle(GiveHint()))
    assert "not been asked" in tool_text(controller.handle(RetryQuestion()))
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    assert "feedback first" in tool_text(controller.handle(RetryQuestion()))


def test_menu_buttons_map_to_the_same_steps_as_voice_but_ask_the_model_to_speak():
    for option, voice in (("retry", RetryQuestion()), ("repeat", RepeatQuestion()), ("hint", GiveHint()),
                          ("next", NextQuestion()), ("feedback", GiveFeedback())):
        by_voice = menu_controller().handle(voice)
        by_button = menu_controller().handle(MenuChoice(option))
        assert by_button[:-1] == by_voice[:-1]
        assert by_button[-1] == GenerateReply(tool_text(by_voice))


def test_how_was_that_button_while_answering_gives_feedback_on_the_answer_so_far():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    actions = controller.handle(MenuChoice("feedback"))
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="I rebuilt the scheduler.")
    assert isinstance(actions[-1], GenerateReply) and "answer so far" in actions[-1].instructions


def spoken(actions):
    """Leave out the clock's room-state updates."""
    return [action for action in actions if not isinstance(action, PublishRoomState)]


def test_a_long_answer_gets_one_polite_nudge_at_three_minutes():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    assert spoken(controller.handle(Tick(now=1_000.0))) == []
    assert spoken(controller.handle(Tick(now=1_179.0))) == []
    actions = spoken(controller.handle(Tick(now=1_180.0)))
    assert len(actions) == 1 and isinstance(actions[0], GenerateReply)
    assert "wrap" in actions[0].instructions.lower()
    assert spoken(controller.handle(Tick(now=1_500.0))) == []  # once per answer


def test_each_new_prompt_gets_its_own_nudge_and_other_phases_never_nudge():
    controller, _ = started_controller(answer_cap=3)
    assert spoken(controller.handle(Tick(now=0.0))) == []
    assert spoken(controller.handle(Tick(now=500.0))) == []  # still asking: not answering yet
    asked_and_recorded(controller)
    controller.handle(Tick(now=500.0))
    controller.handle(CandidateTurnFinished(text="Answer."))
    assert spoken(controller.handle(Tick(now=600.0))) == []
    controller.handle(AskFollowUp(question_text="Why?"))
    controller.handle(InterviewerTurnFinished(text="Why?"))
    controller.handle(Tick(now=610.0))
    assert spoken(controller.handle(Tick(now=789.0))) == []
    assert isinstance(spoken(controller.handle(Tick(now=790.0)))[0], GenerateReply)


def test_a_menu_left_waiting_three_minutes_says_goodbye_then_finishes_as_idle():
    controller = menu_controller()
    assert controller.handle(Tick(now=50.0)) == []
    assert controller.handle(Tick(now=229.0)) == []
    actions = controller.handle(Tick(now=230.0))
    assert actions[0] == PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="closing")
    assert isinstance(actions[1], GenerateReply) and "goodbye" in actions[1].instructions.lower()
    assert "ended" in tool_text(controller.handle(RetryQuestion())).lower()
    assert controller.handle(InterviewerTurnFinished(text="I'll let you go for now. Goodbye!")) == [
        SendHeartbeat(sequence=1, billed_seconds_delta=0, final=True),
        ReportFinish(reason="idle", final_sequence=1),
        PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="ended"),
        EndSession(),
    ]
    assert controller.handle(Tick(now=1_000.0)) == []


def test_a_choice_at_the_menu_restarts_its_idle_wait():
    controller = menu_controller()
    controller.handle(Tick(now=0.0))
    controller.handle(Tick(now=170.0))
    controller.handle(GiveHint())
    controller.handle(InterviewerTurnFinished(text="Try leading with the outcome."))
    controller.handle(Tick(now=171.0))
    assert controller.handle(Tick(now=350.0)) == []
    assert isinstance(controller.handle(Tick(now=351.0))[1], GenerateReply)


def test_offer_menu_gives_feedback_first_and_at_the_menu_only_offers_the_choices_again():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    assert "not answered" in tool_text(controller.handle(OfferMenu())).lower()
    controller.handle(CandidateTurnFinished(text="My answer."))
    actions = controller.handle(OfferMenu())
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    assert "Quick feedback:" in tool_text(actions)
    controller.handle(InterviewerTurnFinished(text="Quick feedback: good."))
    actions = controller.handle(OfferMenu())
    assert len(actions) == 1 and "wait for their choice" in tool_text(actions).lower()
    assert controller.handle(InterviewerTurnFinished(text="You can try again, get a hint or move on.")) == []


def clock_states(actions):
    return [(action.seconds_left, action.time_warning) for action in actions if isinstance(action, PublishRoomState)]


def test_counted_time_excludes_the_waiting_menu_and_is_billed_in_heartbeats():
    controller, _ = started_controller()
    controller.handle(Tick(now=0.0))
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(Tick(now=40.4))
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=1, billed_seconds_delta=40)]
    controller.handle(NextQuestion())
    menu = controller.handle(InterviewerTurnFinished(text="Quick feedback: clear."))
    assert clock_states(menu) == [(1_460, False)]
    for now in (60.0, 120.0, 200.0):
        assert controller.handle(Tick(now=now)) == []  # the menu waits for free
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=2, billed_seconds_delta=0)]
    actions = controller.handle(NextQuestion())
    assert clock_states(actions) == [(1_460, False)]
    controller.handle(Tick(now=210.0))
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=3, billed_seconds_delta=10)]


def test_the_clock_is_published_about_every_five_seconds_and_on_phase_changes():
    controller, _ = started_controller()
    controller.handle(Tick(now=0.0))
    assert controller.handle(Tick(now=3.0)) == []
    assert clock_states(controller.handle(Tick(now=5.0))) == [(1_495, False)]
    assert controller.handle(Tick(now=9.0)) == []
    assert clock_states(controller.handle(InterviewerTurnFinished(text="Tell me about a project."))) == [(1_491, False)]
    assert clock_states(controller.handle(Tick(now=16.0))) == [(1_484, False)]


def test_two_minutes_left_is_said_once_and_shown_in_the_room():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(Tick(now=0.0))
    controller.handle(Tick(now=200.0))  # the long-answer nudge
    assert spoken(controller.handle(Tick(now=1_379.0))) == []
    actions = controller.handle(Tick(now=1_380.0))
    assert clock_states(actions) == [(120, True)]
    assert len(spoken(actions)) == 1 and "two minutes" in spoken(actions)[0].instructions.lower()
    assert spoken(controller.handle(Tick(now=1_390.0))) == []
    assert controller.handle(HeartbeatReplied(action="warn", allowance_seconds_left=100)) == []  # only once overall


def test_time_up_waits_for_the_current_turn_then_closes_and_finishes_with_time_limit():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer"))
    controller.handle(Tick(now=0.0))
    controller.handle(Tick(now=1_380.0))
    assert controller.handle(SpeakingChanged(who="candidate", speaking=True)) == []
    assert spoken(controller.handle(Tick(now=1_500.0))) == []  # the candidate is mid-sentence
    assert "time is up" in tool_text(controller.handle(AskFollowUp(question_text="Why?"))).lower()
    assert controller.handle(MenuChoice(option="next")) == []
    controller.handle(CandidateTurnFinished(text="and that was the result."))
    actions = controller.handle(SpeakingChanged(who="candidate", speaking=False))
    assert actions[:2] == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer and that was the result."),
        PublishRoomState(seconds_left=0, question_position=0, question_total=5, phase="closing", time_warning=True),
    ]
    assert isinstance(actions[2], SayClosing) and "time" in actions[2].instructions.lower() and len(actions) == 3
    assert controller.handle(InterviewerTurnFinished(text="We're out of time, thank you!")) == []
    assert controller.handle(ClosingSpoken()) == [
        SendHeartbeat(sequence=1, billed_seconds_delta=1_500, final=True),
        ReportFinish(reason="time_limit", final_sequence=1),
        PublishRoomState(seconds_left=0, question_position=0, question_total=5, phase="ended", time_warning=True),
        EndSession(),
    ]
    assert controller.handle(ClosingSpoken()) == []


def test_the_closing_waits_while_the_interviewer_is_still_talking():
    controller, _ = started_controller()
    controller.handle(SpeakingChanged(who="interviewer", speaking=True))
    assert spoken(controller.handle(HeartbeatReplied(action="wrap_up", reason="allowance", allowance_seconds_left=0))) == []
    actions = controller.handle(SpeakingChanged(who="interviewer", speaking=False))
    assert isinstance(actions[-1], SayClosing) and "live minutes" in actions[-1].instructions.lower()
    assert controller.handle(ClosingSpoken())[1] == ReportFinish(reason="allowance", final_sequence=1)


def test_an_allowance_warning_from_rails_is_said_once_and_a_wrap_up_closes_from_the_menu():
    controller = menu_controller()
    actions = controller.handle(HeartbeatReplied(action="warn", allowance_seconds_left=110))
    assert clock_states(actions) == [(1_500, True)]
    assert "two minutes" in spoken(actions)[0].instructions.lower()
    assert controller.handle(HeartbeatReplied(action="warn", allowance_seconds_left=100)) == []
    assert controller.handle(HeartbeatReplied(action="continue", allowance_seconds_left=300)) == []
    actions = controller.handle(HeartbeatReplied(action="wrap_up", reason="allowance", allowance_seconds_left=0))
    assert [type(action) for action in actions] == [PublishRoomState, SayClosing]
    assert controller.handle(HeartbeatReplied(action="wrap_up", reason="time_limit", allowance_seconds_left=0)) == []
    assert controller.handle(ClosingSpoken())[1] == ReportFinish(reason="allowance", final_sequence=1)


# Dropped connections: the agent waits up to 2 minutes for the candidate to come back.


def test_a_candidate_who_leaves_for_two_minutes_has_the_answer_saved_and_the_interview_finished_as_disconnected():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(Tick(now=0.0))
    controller.handle(CandidateTurnFinished(text="Half an answer."))
    controller.handle(Tick(now=10.0))
    assert controller.handle(CandidateLeft(now=10.0)) == []
    assert spoken(controller.handle(Tick(now=129.0))) == []
    assert controller.handle(Tick(now=130.0)) == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="Half an answer."),
        SendHeartbeat(sequence=1, billed_seconds_delta=10, final=True),
        ReportFinish(reason="disconnected", final_sequence=1),
        PublishRoomState(seconds_left=1_490, question_position=0, question_total=5, phase="ended"),
        EndSession(),
    ]
    assert controller.handle(Tick(now=500.0)) == []


def test_time_away_is_not_counted_but_heartbeats_continue():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(Tick(now=0.0))
    controller.handle(Tick(now=20.0))
    controller.handle(CandidateLeft(now=20.0))
    controller.handle(Tick(now=80.0))
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=1, billed_seconds_delta=20)]
    controller.handle(CandidateJoined(now=100.0))
    controller.handle(Tick(now=101.0))
    controller.handle(Tick(now=105.0))
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=2, billed_seconds_delta=5)]


def test_a_candidate_back_within_two_minutes_is_welcomed_back_and_asked_the_current_prompt_again():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="First part."))
    controller.handle(SpeakingChanged(who="candidate", speaking=True))
    controller.handle(CandidateLeft(now=5.0))
    assert spoken(controller.handle(Tick(now=100.0))) == []
    actions = controller.handle(CandidateJoined(now=110.0))
    assert len(actions) == 1 and isinstance(actions[0], GenerateReply)
    assert "welcome" in actions[0].instructions.lower() and "repeat" in actions[0].instructions.lower()
    assert spoken(controller.handle(Tick(now=300.0))) == []  # the 2-minute wait is over
    controller.handle(CandidateTurnFinished(text="Second part."))
    actions = controller.handle(FinishAnswer())
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="First part. Second part.")


def test_the_menu_is_offered_again_on_return_and_its_idle_wait_ignores_the_time_away():
    controller = menu_controller()
    controller.handle(Tick(now=0.0))
    controller.handle(Tick(now=100.0))
    controller.handle(CandidateLeft(now=100.0))
    controller.handle(Tick(now=200.0))
    actions = controller.handle(CandidateJoined(now=210.0))
    assert "welcome" in actions[0].instructions.lower() and "choices" in actions[0].instructions.lower()
    assert controller.handle(Tick(now=289.0)) == []  # 100 s waited before leaving + 79 s since
    assert isinstance(controller.handle(Tick(now=290.0))[1], GenerateReply)


def test_nothing_new_is_said_while_the_candidate_is_away():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    controller.handle(CandidateLeft(now=0.0))
    actions = controller.handle(InterviewerTurnFinished(text="Quick feedback: clear."))
    assert [type(action) for action in actions] == [ReportFeedbackGiven, PublishRoomState]
    assert controller.handle(HeartbeatReplied(action="warn", allowance_seconds_left=110))[1:] == []
    actions = controller.handle(CandidateJoined(now=30.0))
    assert len(actions) == 1 and "choices" in actions[0].instructions.lower()
    assert "two minutes" in controller.handle(SpeakingChanged(who="interviewer", speaking=False))[0].instructions


def test_a_wrap_up_while_the_candidate_is_away_finishes_without_a_closing():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(CandidateLeft(now=0.0))
    actions = controller.handle(HeartbeatReplied(action="wrap_up", reason="allowance", allowance_seconds_left=0))
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    assert ReportFinish(reason="allowance", final_sequence=1) in actions and actions[-1] == EndSession()


# A fresh agent (the old one crashed, or the room was re-created) picks up where Rails says it is.


def resumed(**restore):
    controller = LiveInterviewController()
    actions = controller.handle(Started(question_position=1, question_total=5, answer_cap=2, session_seconds_left=900,
                                        **restore))
    return controller, actions


def test_a_resumed_agent_continues_the_heartbeat_sequence_rails_last_applied():
    controller, _ = resumed(heartbeat_sequence=7)
    assert controller.handle(HeartbeatDue()) == [SendHeartbeat(sequence=8, billed_seconds_delta=0)]


def test_a_resumed_agent_repeats_an_asked_opening_and_saves_the_answer_to_it_without_reporting_it_again():
    controller, actions = resumed(current_prompt_message_id="opening-1", current_prompt_kind="opening")
    assert actions[0] == PublishRoomState(seconds_left=900, question_position=1, question_total=5, phase="answering")
    assert "continue" in actions[1].instructions.lower() and "repeat question 2" in actions[1].instructions.lower()
    assert controller.handle(InterviewerTurnFinished(text="Welcome back. Tell me about a conflict.")) == []
    controller.handle(CandidateTurnFinished(text="We disagreed on scope."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="opening-1",
                                                                        transcript="We disagreed on scope.")


def test_a_resumed_answered_opening_counts_toward_the_cap_and_keys_its_follow_up_like_the_first_agent_did():
    controller, _ = resumed(current_prompt_message_id="opening-1", current_prompt_kind="opening",
                            current_prompt_answered=True, answer_count=1)
    assert "answer is saved" in tool_text(controller.handle(FinishAnswer())).lower()
    controller.handle(AskFollowUp(question_text="Why?"))
    assert controller.handle(InterviewerTurnFinished(text="Why did it matter?"))[0] == ReportPromptAsked(
        question_position=1, kind="follow_up", text="Why did it matter?", prompt_key="q1-r0-f1")
    controller.handle(PromptRecorded(question_position=1, message_id="follow-1", prompt_key="q1-r0-f1"))
    controller.handle(CandidateTurnFinished(text="Deadlines."))
    actions = controller.handle(FinishAnswer())  # the second answer reaches the cap of 2
    assert actions[0] == ReportAnswerFinished(prompt_message_id="follow-1", transcript="Deadlines.")
    # This agent never heard the opening's answer, so it gives no feedback on the question.
    assert tool_text(actions) == NO_FEEDBACK_AFTER_RECONNECT


def test_a_resumed_agent_offers_the_menu_after_feedback_or_when_a_follow_up_it_never_heard_is_current():
    for restore in ({"current_prompt_kind": "opening", "feedback_given": True},
                    {"current_prompt_kind": "follow_up", "current_prompt_answered": False}):
        controller, actions = resumed(current_prompt_message_id="prompt", answer_count=1, **restore)
        assert actions[0] == PublishRoomState(seconds_left=900, question_position=1, question_total=5, phase="menu",
                                              menu_offered=True)
        assert "choices" in actions[1].instructions.lower()
        assert controller.handle(NextQuestion())[0] == ReportQuestionAdvanced(question_position=1)


def test_a_resumed_agent_never_gives_or_saves_feedback_on_answers_it_did_not_hear():
    """After a takeover the realtime session never heard the earlier answers, so feedback on them
    would be invented: the agent says so, offers the menu and never replaces the saved feedback."""
    for restore in ({"current_prompt_kind": "opening", "feedback_given": True},
                    {"current_prompt_kind": "follow_up", "current_prompt_answered": True}):
        controller, _ = resumed(current_prompt_message_id="prompt", answer_count=1, **restore)
        for event in (GiveFeedback(), MenuChoice(option="feedback")):
            actions = controller.handle(event)
            text = actions[-1].text if isinstance(actions[-1], ToolResult) else actions[-1].instructions
            assert text == NO_FEEDBACK_AFTER_RECONNECT
            assert "reconnect" in text and "move on" in text
            assert not any(isinstance(action, ReportFeedbackGiven) for action in actions)
        assert controller.handle(InterviewerTurnFinished(text="Sorry, I can't comment on that part.")) == []
        assert controller.handle(RetryQuestion())[0] == ReportQuestionRetried(question_position=1, retry_number=1)
        controller.handle(InterviewerTurnFinished(text="Tell me about a conflict."))
        controller.handle(PromptRecorded(question_position=1, message_id="opening-1"))
        controller.handle(CandidateTurnFinished(text="We disagreed on scope."))
        assert "Quick feedback:" in tool_text(controller.handle(NextQuestion()))  # a retried answer was heard


def test_a_resumed_agent_coaches_an_inherited_opening_answer_once_the_candidate_answers_again():
    controller, _ = resumed(current_prompt_message_id="opening-1", current_prompt_kind="opening",
                            current_prompt_answered=True, answer_count=1)
    assert tool_text(controller.handle(OfferMenu())) == NO_FEEDBACK_AFTER_RECONNECT
    controller, _ = resumed(current_prompt_message_id="opening-1", current_prompt_kind="opening",
                            current_prompt_answered=True, answer_count=1)
    controller.handle(CandidateTurnFinished(text="We disagreed on scope."))  # new words replace the unheard answer
    actions = controller.handle(OfferMenu())
    assert actions[0] == ReportAnswerFinished(prompt_message_id="opening-1", transcript="We disagreed on scope.")
    assert "Quick feedback:" in tool_text(actions)


def test_a_resumed_agent_whose_opening_was_never_asked_asks_it_as_before():
    controller, actions = resumed()
    assert actions[0].phase == "asking" and "ask question 2" in actions[1].instructions.lower()
    assert controller.handle(InterviewerTurnFinished(text="Tell me about a conflict."))[0] == ReportPromptAsked(
        question_position=1, kind="opening", text="Tell me about a conflict.")


def test_an_agent_that_starts_in_an_empty_room_waits_for_the_candidate_before_asking():
    controller = LiveInterviewController()
    assert controller.handle(CandidateLeft(now=0.0)) == []
    actions = controller.handle(Started(question_position=0, question_total=5, answer_cap=2, session_seconds_left=1_500))
    assert actions == [PublishRoomState(seconds_left=1_500, question_position=0, question_total=5, phase="asking")]
    actions = controller.handle(CandidateJoined(now=30.0))
    assert "welcome" in actions[0].instructions.lower() and "ask the current question" in actions[0].instructions.lower()
    assert controller.handle(InterviewerTurnFinished(text="Welcome back. Tell me about a project."))[0] == ReportPromptAsked(
        question_position=0, kind="opening", text="Welcome back. Tell me about a project.")


def preamble(text):
    """Words the model spoke in the same response as a tool call, before the tool's result."""
    return InterviewerTurnFinished(text=text, preamble=True)


def test_a_preamble_before_the_last_next_question_does_not_cut_the_closing():
    controller = menu_controller(position=4)
    controller.handle(NextQuestion())
    assert controller.handle(preamble("Sure, let's wrap up.")) == []
    assert controller.handle(InterviewerTurnFinished(text="Thank you so much. Goodbye!"))[1] == ReportFinish(
        reason="completed", final_sequence=1)


def test_a_preamble_before_ask_follow_up_is_not_saved_as_the_follow_up():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    controller.handle(AskFollowUp(question_text="What changed?"))
    assert controller.handle(preamble("Sure.")) == []
    assert controller.handle(InterviewerTurnFinished(text="What changed for the team?"))[0] == ReportPromptAsked(
        question_position=0, kind="follow_up", text="What changed for the team?", prompt_key="q0-r0-f1")


def test_a_preamble_before_give_feedback_is_not_saved_as_the_feedback():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    controller.handle(NextQuestion())
    assert controller.handle(preamble("Okay, let me think about that.")) == []
    actions = controller.handle(InterviewerTurnFinished(text="Quick feedback: clear example."))
    assert actions[0] == ReportFeedbackGiven(question_position=0, text="Quick feedback: clear example.")
    assert isinstance(actions[-1], GenerateReply) and "hint" in actions[-1].instructions  # the menu follows it


def test_answers_to_a_prompt_rails_has_not_recorded_yet_are_reported_once_it_is():
    controller, _ = started_controller()
    controller.handle(InterviewerTurnFinished(text="Tell me about a project."))  # its report was lost
    controller.handle(CandidateTurnFinished(text="I rebuilt the scheduler."))
    actions = controller.handle(AskFollowUp(question_text="What changed?"))
    assert not any(isinstance(action, ReportAnswerFinished) for action in actions)
    assert "ask" in tool_text(actions).lower()
    controller.handle(InterviewerTurnFinished(text="What changed for the team?"))
    # The adapter resends the opening first; its receipt releases the answer, ahead of the follow-up.
    assert controller.handle(PromptRecorded(question_position=0, message_id="opening-0")) == [
        ReportAnswerFinished(prompt_message_id="opening-0", transcript="I rebuilt the scheduler.")]
    assert controller.handle(PromptRecorded(question_position=0, message_id="opening-0")) == []
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1", prompt_key="q0-r0-f1"))
    controller.handle(CandidateTurnFinished(text="Fewer failed runs."))
    assert controller.handle(FinishAnswer())[0] == ReportAnswerFinished(prompt_message_id="follow-1",
                                                                        transcript="Fewer failed runs.")


def test_a_retry_drops_an_answer_still_waiting_for_its_prompt_to_be_recorded():
    controller, _ = started_controller()
    controller.handle(InterviewerTurnFinished(text="Tell me about a project."))
    controller.handle(CandidateTurnFinished(text="Abandoned words."))
    controller.handle(FinishAnswer())
    controller.handle(RetryQuestion())
    controller.handle(InterviewerTurnFinished(text="Let's try again: tell me about a project."))
    assert controller.handle(PromptRecorded(question_position=0, message_id="opening-0")) == []


def test_an_answer_rails_refused_is_not_counted_as_saved():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="My answer."))
    report = ReportAnswerFinished(prompt_message_id="opening-0", transcript="My answer.")
    assert controller.handle(FinishAnswer())[0] == report
    assert controller.handle(AnswerNotSaved(prompt_message_id="opening-0", transcript="My answer.")) == []
    assert controller.handle(FinishAnswer())[0] == report  # still unsaved, so it is reported again
    controller.handle(AskFollowUp(question_text="Why?"))
    assert controller.handle(InterviewerTurnFinished(text="Why?"))[0].prompt_key == "q0-r0-f1"  # counted once


def test_a_long_answer_is_cut_at_a_word_to_the_rails_limit():
    """Rails refuses answers over 4,000 characters (TextLimits::PROSE; the Rails spec
    internal_interview_live_connections_spec.rb pins the same number), so the reported answer
    keeps the beginning, cut at a word boundary, instead of being refused on every resend."""
    from live_interviews.controller import ANSWER_LIMIT

    assert ANSWER_LIMIT == 4_000
    controller, _ = started_controller()
    asked_and_recorded(controller)
    words = " ".join(f"word{index}" for index in range(1_000))  # about 6,900 characters
    controller.handle(CandidateTurnFinished(text=words))
    controller.handle(CandidateTurnFinished(text="the end"))
    actions = controller.handle(FinishAnswer())
    report = next(action for action in actions if isinstance(action, ReportAnswerFinished))
    assert len(report.transcript) <= ANSWER_LIMIT
    assert words.startswith(report.transcript)
    assert words[len(report.transcript)] == " "  # cut between words, never inside one
    assert len(report.transcript) > ANSWER_LIMIT - 20
    again = controller.handle(FinishAnswer())  # the same words: nothing is reported again
    assert not any(isinstance(action, ReportAnswerFinished) for action in again)
