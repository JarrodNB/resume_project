"""Translate validated frozen choices into preparation and follow-up instructions.

These trusted choices change questioning style, never career evidence or progression.
"""


def interview_style(setup):
    difficulty = {
        "warm_up": "Warm-up: use foundational questions and a supportive pace.",
        "realistic": "Realistic: match a typical on-site or video round.",
        "stretch": "Stretch: use probing follow-ups and harder scenarios.",
    }[setup.difficulty]
    interviewer = {
        "maya": "Maya — Friendly Coach: warm and encouraging; give room to think, without coaching or grading.",
        "daniel": "Daniel — Professional Hiring Manager: neutral and structured, like a panel member.",
        "priya": "Priya — Tough Interviewer: direct; press for specifics and measurable impact after submission only.",
    }[setup.interviewer]
    focus = ", ".join(area.replace("_", " ").replace("impact metrics", "impact & metrics") for area in setup.focus_areas)
    return (f"{difficulty}\n{interviewer}\nSelected question format: {setup.question_format}. "
        f"Selected focus areas: {focus or 'none'}. "
        "Focus areas bias format-compatible questions; never override the selected question format. "
        "Never interrupt a live answer. Preserve factual acknowledgements, no coaching or scoring, "
        "and all answer caps and advancement rules; never invent achievements or measurable outcomes. "
        "Keep the existing British speech voice; persona changes questioning style only.")
