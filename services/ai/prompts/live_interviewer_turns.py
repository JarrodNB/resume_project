"""Turn instructions and tool results for the live (real-time voice) practice interviewer.

Input: the live interview controller (live_interviews/controller.py) picks one of these for each
step and fills in the zero-based question position where a builder takes one. Output: the words
the realtime model is told to follow, either as a `generate_reply` turn instruction or as the
result of one of its interview tools (ask_follow_up, finish_answer, repeat_question,
next_question, give_feedback, offer_menu, give_hint, retry_question). Questions are numbered from
1 for the model. The session instructions hold no questions: a builder that asks one is given
that question's escaped data section (`live_question_blocks` in live_interviews/instructions.py).

These texts and the framing in prompts/live_interviewer_instructions.py are one prompt, labelled
by LIVE_INTERVIEWER_PROMPT_VERSION there: bump it when either file changes what the model is told.
"""


def ask_question_instructions(question_position: int, question: str) -> str:
    """The end of an instruction to ask one prepared question ("...then ask question 2: ...")."""
    return (f"question {question_position + 1}, which is:\n{question}\nKeep its meaning and ask it as one clear "
            "question in your own natural spoken words. Then stop and let the candidate answer.")


def resume_instructions(question_position: int, question: str) -> str:
    """A fresh agent taking over mid-question greets the candidate and repeats the question."""
    return ("Greet the candidate briefly and say you will continue the interview, then repeat "
            + ask_question_instructions(question_position, question))


def ask_again_instructions(kind: str, question_position: int, question: str) -> str:
    """Ask the current prompt after the candidate cut it off, or after a reply the model made on
    its own instead of asking it."""
    if kind == "follow_up":
        return ("Acknowledge what the candidate just said in a few words, then ask your follow-up question now in "
                "one short, natural spoken question. Then stop and let the candidate answer.")
    return ("Acknowledge what the candidate just said in a few words, then ask "
            + ask_question_instructions(question_position, question))


def opening_instructions(question_position: int, question: str) -> str:
    """The greeting and the current question at the start (a warmer greeting for question 1)."""
    greeting = ("Greet the candidate warmly in one short sentence in your interviewer style, "
                "then ask " if question_position == 0 else
                "Greet the candidate briefly and say you will continue the interview, then ask ")
    return greeting + ask_question_instructions(question_position, question)


NOT_STARTED = "The interview has not started yet. Wait."
ENDED = "The interview has ended. Do not ask anything else."
NOT_ANSWERED = "The candidate has not answered yet. Let them answer before you continue."
ANSWER_SAVED = ("The answer is saved. Ask one follow-up with ask_follow_up if it would help, "
                "or call next_question to move on.")
ASK_FOLLOW_UP = ("Ask that follow-up now in one short, natural spoken question. Then stop and let the "
                 "candidate answer.")
REPEAT = ("Repeat the current question or follow-up now, clearly and with the same meaning. You may "
          "rephrase it slightly. Do not ask anything new.")
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
NO_FEEDBACK_AFTER_RECONNECT = (
    "You reconnected partway through this question and did not hear the candidate's earlier answers. Say briefly "
    "that you can't give feedback on that part after the reconnect, then offer their choices in one short sentence: "
    "try the question again, hear the question again, get a hint, or move on. Wait for their choice.")
FEEDBACK_FIRST = ("You are already giving this question's quick feedback. Do not start it again and do not add "
                  "anything else now.")
STILL_ANSWERING = ("The candidate's answer is still very short, so they have probably only paused to think. Do not "
                   "ask a follow-up or move on yet. If they stopped mid-sentence, say only a brief \"Mm-hm, go on.\" "
                   "Otherwise invite them, in one short sentence, to say a bit more about the same thing. Then let "
                   "them talk.")
MENU = ("Now offer the candidate their choices in one short, friendly sentence: try the question again, hear the "
        "question again, get a hint, or move on. Then stop and wait for their choice. Never move on until they "
        "choose.")
CHOOSING = ("The candidate is choosing what to do next: try the question again, hear the question again, get a "
            "hint, or move on. Do not ask anything new; wait for their choice.")
MENU_AGAIN = ("Offer the candidate their choices again in one short sentence: try the question again, hear the "
              "question again, get a hint, or move on. Then wait for their choice.")
REPEAT_FROM_MENU = ("Repeat the core question clearly, with the same meaning; you may rephrase it slightly. Then "
                    "offer the choices again (try again, get a hint, or move on) and wait for their choice.")
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
NUDGE = ("The candidate has been answering this for about three minutes. Politely cut in once, in one short "
         "sentence, and ask them to wrap that answer up in a sentence or two.")
IDLE_GOODBYE = ("The candidate has not chosen anything for three minutes. Say in one or two short sentences that you "
                "will stop here for now, thank them and say goodbye. Do not ask anything else.")
CLOSING = ("That was the last question. Thank the candidate warmly in one or two short sentences and "
           "say goodbye. Do not ask anything else or give feedback.")
RESUME_AT_MENU = ("Greet the candidate briefly and say you will pick up where you left off. Then offer their choices in "
                  "one short sentence: try the question again, hear the question again, get a hint, or move on. Wait "
                  "for their choice.")
WELCOME_BACK = "The candidate's connection dropped and they are back. Welcome them back in one short sentence, then "
WELCOME_BACK_TO = {
    "asking": WELCOME_BACK + ("ask the current question or follow-up clearly, with the same meaning, and let them "
                              "answer."),
    "answering": WELCOME_BACK + ("repeat the current question or follow-up clearly, with the same meaning, and let "
                                 "them answer."),
    "feedback": WELCOME_BACK + "give your quick feedback. " + FEEDBACK_AGAIN,
    "menu": WELCOME_BACK + MENU_AGAIN[0].lower() + MENU_AGAIN[1:],
}
TIME_WARNING = ("In one short sentence, tell the candidate there are about two minutes left, so they can start to "
                "wrap up. Then carry on where you were.")
TIME_UP = "Time is up and the interview is closing. Do not ask anything new."
CHOSEN_IN_ROOM = ("The candidate pressed a button in the room while this call was running, so it was not done. "
                  "Their choice is followed instead; do not mention this call.")
WRAP_UP = {
    "time_limit": ("We are out of time for this practice interview. In one or two short sentences, say that time is "
                   "up, thank the candidate warmly and say goodbye. Do not ask anything else."),
    "allowance": ("The candidate has used their live minutes for now. In one or two short sentences, say that their "
                  "live minutes are used up for now, thank them warmly and say goodbye. Do not ask anything else."),
}
