"""
Description: Character caps checked before a Jev call or a generative run. The same numbers
live in Rails (`TextLimits`) for fields the API stores. Oversized text is rejected, not cut.
Index:
    - MAX_RESUME_TEXT / MAX_PDF_PAGES: extracted resume
    - MAX_SCREENED_TEXT: one string sent to Jev
    - MAX_INTERVIEW_ANSWER: user-written interview answer cap
    - MAX_PROMPT_TEXT: one gap-analysis or tailoring prompt
    - MAX_SORT_BULLETS / MAX_SORT_BULLET_TEXT: the requirements sorting agent
    - MAX_SHORT_TEXT / MAX_BULLET_TEXT / MAX_JOB_DESCRIPTION / MAX_REQUIREMENT_ITEMS:
      the same caps Rails uses when it saves a scraped job
    - prompt_is_too_long / sorting_input_too_long: the checks
    - RESUME_TOO_LONG_MESSAGE / GAP_PROMPT_TOO_LONG_MESSAGE / TAILOR_PROMPT_TOO_LONG_MESSAGE /
      TAILOR_LIBRARY_TOO_LONG_MESSAGE /
      SECTION_TOO_LONG_MESSAGE / POSTING_TOO_LONG_TO_SORT_WARNING /
      POSTING_LEFT_OUT_WARNING / NOTE_TOO_LONG_WARNING: what the user is told
"""

MAX_RESUME_TEXT = 80_000
MAX_PDF_PAGES = 30
MAX_SCREENED_TEXT = 80_000
MAX_PROMPT_TEXT = 120_000
MAX_INTERVIEW_ANSWER = 2_000
MAX_SORT_BULLETS = 200
MAX_SORT_BULLET_TEXT = 40_000
MAX_SHORT_TEXT = 200
MAX_BULLET_TEXT = 1_000
MAX_JOB_DESCRIPTION = 20_000
MAX_REQUIREMENT_ITEMS = 80

JOB_AD_TOO_LONG_MESSAGE = "This job posting is too long to parse. Paste a shorter ad, or add the job manually."

RESUME_TOO_LONG_MESSAGE = "This resume is too long to import. Shorten it and upload it again."
GAP_PROMPT_TOO_LONG_MESSAGE = (
    "Your career library or this job's text is too long to compare. Shorten an entry and try again."
)
TAILOR_PROMPT_TOO_LONG_MESSAGE = (
    "Your career library or this job's text is too long to write from. Shorten an entry and try again."
)
TAILOR_LIBRARY_TOO_LONG_MESSAGE = (
    "Your career library is too long to tailor a resume (over 80,000 characters). "
    "Shorten an entry and try again."
)
SECTION_TOO_LONG_MESSAGE = "This section is too long. Shorten it and try again."
POSTING_TOO_LONG_TO_SORT_WARNING = (
    "This posting is too long to sort into requirements. Add them by hand."
)
POSTING_LEFT_OUT_WARNING = (
    "Part of this posting was too long to save, so the extra text was left out."
)
NOTE_TOO_LONG_WARNING = "One of your notes was left out because it is too long."


def prompt_is_too_long(text: str) -> bool:
    """True when an assembled prompt is over the generative cap."""
    return len(text) > MAX_PROMPT_TEXT


def sorting_input_too_long(bullets: list[str]) -> bool:
    """True when the sorting agent would be handed too many bullets or too much text."""
    return len(bullets) > MAX_SORT_BULLETS or sum(len(bullet) for bullet in bullets) > MAX_SORT_BULLET_TEXT
