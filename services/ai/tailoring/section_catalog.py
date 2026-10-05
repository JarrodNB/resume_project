"""
Description: The fixed order of a tailored resume. Contact is copied from the profile; the
rest are written one agent run at a time. The model does not choose when to stop.
Index:
    - SECTION_ORDER / WRITTEN_SECTIONS / SECTION_TITLES: order and display titles
    - next_section: the first section not yet approved or omitted
    - sections_before: sections that stay when an earlier one is reopened
"""

SECTION_ORDER = ("contact", "summary", "experience", "projects", "education", "skills")
WRITTEN_SECTIONS = SECTION_ORDER[1:]
SECTION_TITLES = {
    "contact": "Contact",
    "summary": "Summary",
    "experience": "Experience",
    "projects": "Projects",
    "education": "Education",
    "skills": "Skills",
}
ENTRY_PREFIX = {"experience": "E", "projects": "P", "education": "ED", "skills": "S"}


def next_section(done: list[str]) -> str | None:
    """The next section to write, or None when every section is done."""
    finished = set(done)
    for section_type in SECTION_ORDER:
        if section_type not in finished:
            return section_type
    return None


def sections_before(section_type: str) -> set[str]:
    """Section types that remain when `section_type` is reopened (it and later ones go)."""
    index = SECTION_ORDER.index(section_type)
    return set(SECTION_ORDER[:index])
