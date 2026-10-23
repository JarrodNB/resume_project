"""Check extracted resume values against the uploaded source text.

Remove unsupported highlights and skills, and warn about unmatched names.
Normalize the source once per check without retaining resume text afterward.
"""

from collections.abc import Callable

from documents.text_matching import normalize_text
from schemas.parsed_resume import ParsedExperience, ParsedResume, ParsedSkill


def enforce_source_faithfulness(parsed_resume: ParsedResume, source_text: str) -> ParsedResume:
    """Returns a copy of parsed_resume where nothing unverifiable passes without a warning."""
    normalized_source = normalize_text(source_text)

    def appears_in_source(value: str | None) -> bool:
        normalized_value = normalize_text(value)
        return bool(normalized_value) and normalized_value in normalized_source

    warnings: list[str] = []
    experiences = [
        _check_experience(role, appears_in_source, warnings) for role in parsed_resume.experiences
    ]
    skills = _check_skills(parsed_resume.skills, appears_in_source, warnings)
    _warn_unmatched_names(parsed_resume, appears_in_source, warnings)
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
    role: ParsedExperience, appears_in_source: Callable[[str | None], bool], warnings: list[str]
) -> ParsedExperience:
    """Removes highlights that aren't in the source text, warning about each one."""
    kept_highlights = []
    for highlight in role.highlights:
        if appears_in_source(highlight):
            kept_highlights.append(highlight)
        else:
            warnings.append(
                f"Removed a highlight under {role.company} that doesn't appear word for word "
                f'in the resume: "{highlight}"'
            )
    if len(kept_highlights) == len(role.highlights):
        return role
    return role.model_copy(update={"highlights": kept_highlights})


def _check_skills(
    skills: list[ParsedSkill], appears_in_source: Callable[[str | None], bool], warnings: list[str]
) -> list[ParsedSkill]:
    """Removes skills that aren't in the source text, warning about each one."""
    kept_skills = []
    for skill in skills:
        if appears_in_source(skill.name):
            kept_skills.append(skill)
        else:
            warnings.append(f'Removed a skill that doesn\'t appear in the resume: "{skill.name}"')
    return kept_skills


def _warn_unmatched_names(
    parsed_resume: ParsedResume, appears_in_source: Callable[[str | None], bool], warnings: list[str]
) -> None:
    """Warns (without removing anything) about entry names that aren't in the source text."""
    labelled_names = (
        [("company", role.company) for role in parsed_resume.experiences]
        + [("job title", role.title) for role in parsed_resume.experiences]
        + [("project name", project.name) for project in parsed_resume.projects]
        + [("institution", education.institution) for education in parsed_resume.educations]
        + [("certification name", item.name) for item in parsed_resume.certifications]
    )
    for label, name in labelled_names:
        if not appears_in_source(name):
            warnings.append(
                f'Check this {label}; it doesn\'t appear word for word in the resume: "{name}"'
            )
