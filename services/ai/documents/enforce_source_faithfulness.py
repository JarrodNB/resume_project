"""
Description: Enforces "extract, never rewrite" on a ParsedResume by checking it against the
resume's own text. Highlights and skills not found in the text are removed; experience, project,
education, and certification names not found are kept. Every finding is added to parsing_warnings.
Index:
    - enforce_source_faithfulness: returns a copy of the parse with unverifiable content handled
"""

from documents.text_matching import appears_in
from schemas.parsed_resume import ParsedExperience, ParsedResume, ParsedSkill


def enforce_source_faithfulness(parsed_resume: ParsedResume, source_text: str) -> ParsedResume:
    """Returns a copy of parsed_resume where nothing unverifiable passes without a warning."""
    warnings: list[str] = []
    experiences = [
        _check_experience(role, source_text, warnings) for role in parsed_resume.experiences
    ]
    skills = _check_skills(parsed_resume.skills, source_text, warnings)
    _warn_unmatched_names(parsed_resume, source_text, warnings)
    if not warnings:
        return parsed_resume
    return parsed_resume.model_copy(
        update={
            "experiences": experiences,
            "skills": skills,
            "parsing_warnings": [*parsed_resume.parsing_warnings, *warnings],
        }
    )


def _check_experience(
    role: ParsedExperience, source_text: str, warnings: list[str]
) -> ParsedExperience:
    """Check each scope without moving text between an entry and its roles."""
    def keep(highlights):
        kept = []
        for highlight in highlights:
            if appears_in(highlight, source_text):
                kept.append(highlight)
            else:
                warnings.append(
                    f"Removed a highlight under {role.company} that doesn't appear word for word "
                    f'in the resume: "{highlight}"'
                )
        return kept

    roles = [item.model_copy(update={"highlights": keep(item.highlights)}) for item in role.roles]
    return role.model_copy(update={"roles": roles, "shared_highlights": keep(role.shared_highlights)})


def _check_skills(
    skills: list[ParsedSkill], source_text: str, warnings: list[str]
) -> list[ParsedSkill]:
    """Removes skills that aren't in the source text, warning about each one."""
    kept_skills = []
    for skill in skills:
        if appears_in(skill.name, source_text):
            kept_skills.append(skill)
        else:
            warnings.append(f'Removed a skill that doesn\'t appear in the resume: "{skill.name}"')
    return kept_skills


def _warn_unmatched_names(
    parsed_resume: ParsedResume, source_text: str, warnings: list[str]
) -> None:
    """Warns (without removing anything) about entry names that aren't in the source text."""
    labelled_names = (
        [("company", role.company) for role in parsed_resume.experiences]
        + [("job title", role.title) for entry in parsed_resume.experiences for role in entry.roles]
        + [("project name", project.name) for project in parsed_resume.projects]
        + [("institution", education.institution) for education in parsed_resume.educations]
        + [("certification name", item.name) for item in parsed_resume.certifications]
    )
    for label, name in labelled_names:
        if not appears_in(name, source_text):
            warnings.append(
                f'Check this {label}; it doesn\'t appear word for word in the resume: "{name}"'
            )
