"""Turn the user's saved interview choices into concrete instructions for the model.

Difficulty, interviewer and focus areas change how questions are written and how follow-ups
sound and probe. They never change career evidence, the question format, or Rails-owned
progression; Rails also enforces the per-difficulty answer cap.
"""

FOCUS_AREA_LABELS = {"impact_metrics": "impact & metrics"}

PREPARATION_DIFFICULTY = {
    "warm_up": """Difficulty: Warm-up.
- Ask common, straightforward questions a candidate can expect in almost any interview.
- Keep each question to one simple idea in plain words, with no tricky constraints.
- Favour familiar topics from the candidate's background over edge cases.""",
    "realistic": """Difficulty: Realistic.
- Ask the kind of questions a typical on-site or video round uses for this role.
- Mix familiar questions with a few that need a specific example or a clear explanation.""",
    "stretch": """Difficulty: Stretch.
- Ask harder questions than a typical round: ambiguity, competing priorities, tradeoffs,
  setbacks, things that went wrong, scale or difficult stakeholders.
- For knowledge questions, prefer "why" and "what would you change if" over definitions.
- Stay answerable in a few minutes and grounded in the candidate's field.""",
}

PREPARATION_INTERVIEWER = {
    "maya": "Interviewer: Maya, a friendly coach. Phrase questions warmly and invitingly, e.g. "
        "'I'd love to hear about a time when...'.",
    "daniel": "Interviewer: Daniel, a professional hiring manager. Phrase questions in a neutral, "
        "structured panel style, e.g. 'Describe a situation where...'.",
    "priya": "Interviewer: Priya, a tough interviewer. Phrase questions crisply and directly, and "
        "ask for specifics up front, e.g. 'Walk me through exactly what you did when...'.",
}

FOLLOW_UP_DIFFICULTY = {
    "warm_up": """Difficulty: Warm-up.
- You get at most one follow-up per question. Use it only for an obvious gap, such as a
  missing outcome or what the candidate personally did.
- Advance as soon as the answer covers the basics of the question.""",
    "realistic": """Difficulty: Realistic.
- Advance once the answer gives a clear example with the candidate's own actions and the
  outcome, or a clear explanation for knowledge questions.
- Otherwise ask about the single most important missing detail.""",
    "stretch": """Difficulty: Stretch.
- Hold a high bar. Advance only when the answer covers the candidate's own actions, their
  reasoning or tradeoffs, and a concrete result or what they learned.
- Otherwise keep probing up to the answer limit: ask why they chose that approach, what
  alternatives they rejected, what went wrong, or how they knew it worked.
- Follow-ups may test the answer, e.g. 'What would you do differently if the deadline were halved?'""",
}

FOLLOW_UP_INTERVIEWER = {
    "maya": """Interviewer: Maya, a friendly coach.
- Sound warm and relaxed. Use an acknowledgement most turns: a short, friendly line such as
  thanking them for the example or noting something specific they shared.
- Phrase follow-ups as open invitations, e.g. 'Could you tell me a bit more about how you...?'
- Be patient with short or nervous answers; ask about one easy-to-answer detail.
- Warmth is not grading: do not say an answer was good, strong or correct, and do not coach.""",
    "daniel": """Interviewer: Daniel, a professional hiring manager.
- Sound neutral, polite and structured. Usually leave acknowledgement null.
- Fill gaps in a logical order: the situation, what they personally did, then the result.
- Keep follow-ups short and businesslike, e.g. 'What was the outcome?'""",
    "priya": """Interviewer: Priya, a tough interviewer.
- Sound direct and brisk. Leave acknowledgement null; no thanks or small talk.
- Press for specifics: numbers, timeframes, scale, and exactly what they did versus the team.
  When they say 'we', ask what they personally did.
- Challenge vague or generic claims, e.g. 'How did you measure that?' or 'What happened next?'
- Stay professional: be demanding, never rude, sarcastic or dismissive.""",
}


def _focus_line(setup, purpose):
    if not setup.focus_areas:
        return "Focus areas: none selected."
    areas = ", ".join(FOCUS_AREA_LABELS.get(area, area.replace("_", " ")) for area in setup.focus_areas)
    return f"Focus areas: {areas}. {purpose}"


def preparation_style(setup):
    """Return question-writing instructions for the saved difficulty, interviewer and focus."""
    focus = _focus_line(setup, "Aim at least half of the questions at these areas where the "
        "selected question format allows. Never change the required question types to fit them.")
    return "\n\n".join(["# Interview style", PREPARATION_DIFFICULTY[setup.difficulty],
        PREPARATION_INTERVIEWER[setup.interviewer], focus,
        ("Style changes how questions are chosen and worded only. Never invent achievements or "
         "measurable outcomes.")])


def follow_up_style(setup):
    """Return follow-up tone and probing instructions for the saved difficulty, interviewer and focus."""
    focus = _focus_line(setup, "When choosing what to probe, prefer details that show these areas.")
    return "\n\n".join(["# Interview style",
        "Act out this interviewer and difficulty. They should feel clearly different from the other options.",
        FOLLOW_UP_INTERVIEWER[setup.interviewer], FOLLOW_UP_DIFFICULTY[setup.difficulty], focus,
        ("Never grade, coach or invent facts, and never choose the next question; Rails enforces the "
         "answer limit and progression.")])
