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
    GiveFeedback,
    GiveHint,
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
    Started,
    Tick,
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


def test_follow_ups_stop_at_the_answer_cap_and_the_question_goes_to_feedback():
    controller, _ = started_controller(answer_cap=2)
    asked_and_recorded(controller)
    controller.handle(CandidateTurnFinished(text="First answer."))
    controller.handle(AskFollowUp(question_text="Why?"))
    controller.handle(InterviewerTurnFinished(text="Why did that work?"))
    controller.handle(PromptRecorded(question_position=0, message_id="follow-1"))
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
    controller = menu_controller(position=4)
    actions = controller.handle(NextQuestion())
    assert actions[:2] == [
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
        PublishRoomState(question_position=0, question_total=5, phase="feedback"),
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
        PublishRoomState(question_position=0, question_total=5, phase="menu", menu_offered=True),
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
    assert actions[1] == PublishRoomState(question_position=0, question_total=5, phase="feedback")
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
        PublishRoomState(question_position=0, question_total=5, phase="feedback"),
    ]
    assert "answer so far" in tool_text(actions)
    assert controller.handle(InterviewerTurnFinished(text="Quick feedback: good start. Say what changed.")) == [
        ReportFeedbackGiven(question_position=0, text="Quick feedback: good start. Say what changed."),
        PublishRoomState(question_position=0, question_total=5, phase="answering"),
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
    assert actions[0] == PublishRoomState(question_position=0, question_total=5, phase="feedback")
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
        PublishRoomState(question_position=0, question_total=5, phase="asking"),
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
    controller.handle(Started(question_position=1, question_total=5, answer_cap=2, retry_count=2))
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


def test_a_long_answer_gets_one_polite_nudge_at_three_minutes():
    controller, _ = started_controller()
    asked_and_recorded(controller)
    assert controller.handle(Tick(now=1_000.0)) == []
    assert controller.handle(Tick(now=1_179.0)) == []
    actions = controller.handle(Tick(now=1_180.0))
    assert len(actions) == 1 and isinstance(actions[0], GenerateReply)
    assert "wrap" in actions[0].instructions.lower()
    assert controller.handle(Tick(now=1_500.0)) == []  # once per answer


def test_each_new_prompt_gets_its_own_nudge_and_other_phases_never_nudge():
    controller, _ = started_controller(answer_cap=3)
    assert controller.handle(Tick(now=0.0)) == []
    assert controller.handle(Tick(now=500.0)) == []  # still asking: not answering yet
    asked_and_recorded(controller)
    controller.handle(Tick(now=500.0))
    controller.handle(CandidateTurnFinished(text="Answer."))
    assert controller.handle(Tick(now=600.0)) == []
    controller.handle(AskFollowUp(question_text="Why?"))
    controller.handle(InterviewerTurnFinished(text="Why?"))
    controller.handle(Tick(now=610.0))
    assert controller.handle(Tick(now=789.0)) == []
    assert isinstance(controller.handle(Tick(now=790.0))[0], GenerateReply)


def test_a_menu_left_waiting_three_minutes_says_goodbye_then_finishes_as_idle():
    controller = menu_controller()
    assert controller.handle(Tick(now=50.0)) == []
    assert controller.handle(Tick(now=229.0)) == []
    actions = controller.handle(Tick(now=230.0))
    assert actions[0] == PublishRoomState(question_position=0, question_total=5, phase="closing")
    assert isinstance(actions[1], GenerateReply) and "goodbye" in actions[1].instructions.lower()
    assert "ended" in tool_text(controller.handle(RetryQuestion())).lower()
    assert controller.handle(InterviewerTurnFinished(text="I'll let you go for now. Goodbye!")) == [
        ReportFinish(reason="idle"),
        PublishRoomState(question_position=0, question_total=5, phase="ended"),
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
