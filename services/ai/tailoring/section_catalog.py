"""Define resume display order, generated sections, and source label prefixes."""

SECTION_ORDER = ("contact", "summary", "experience", "projects", "education", "certifications", "skills")
WRITTEN_SECTIONS = ("summary", "experience", "projects", "skills")
SECTION_TITLES = {
    "contact": "Contact",
    "summary": "Summary",
    "experience": "Experience",
    "projects": "Projects",
    "education": "Education",
    "certifications": "Certifications",
    "skills": "Skills",
}
ENTRY_PREFIX = {"experience": "E", "projects": "P", "education": "ED", "certifications": "C", "skills": "S"}
