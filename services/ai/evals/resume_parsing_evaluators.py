"""
Description: Deterministic Pydantic Evals evaluators for the resume parsing agent. Every score
is between 0 and 1.
Index:
    - SourceFaithfulness: highlights, skills, and companies must appear in the resume text
    - ExperienceMatch: expected roles are found (recall), no extra roles (precision), dates right
    - SectionRecall: expected educations, projects, skills, and contact email are found
    - WarnsWhenAmbiguous: a warning is raised for cases labelled as ambiguous
    - RESUME_PARSING_EVALUATORS: all evaluator classes, for Dataset.from_file
"""

from dataclasses import dataclass
from typing import Any

from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import appears_in, fraction, loosely_equal
from schemas.parsed_resume import ParsedExperience, ParsedResume

ResumeContext = EvaluatorContext[str, ParsedResume, dict[str, Any]]


@dataclass
class SourceFaithfulness(Evaluator[str, ParsedResume, dict[str, Any]]):
    """Nothing extracted may be invented: it must appear in the source text."""

    def evaluate(self, ctx: ResumeContext) -> dict[str, float]:
        """Scores the share of highlights, skills, and companies found in the input."""
        highlights = [text for role in ctx.output.experiences for text in role.highlights]
        skills = [skill.name for skill in ctx.output.skills]
        companies = [role.company for role in ctx.output.experiences]
        return {
            "faithful_highlights": _share_in_source(highlights, ctx.inputs),
            "faithful_skills": _share_in_source(skills, ctx.inputs),
            "faithful_companies": _share_in_source(companies, ctx.inputs),
        }


@dataclass
class ExperienceMatch(Evaluator[str, ParsedResume, dict[str, Any]]):
    """Compares extracted roles to the labelled ones, matching on company name."""

    def evaluate(self, ctx: ResumeContext) -> dict[str, float]:
        """Scores recall, precision, and date accuracy of experiences."""
        expected_roles = ctx.expected_output.experiences if ctx.expected_output else []
        ambiguous_names = (ctx.metadata or {}).get("ambiguous_entries", [])
        matches = [(role, _find_role(role, ctx.output.experiences)) for role in expected_roles]
        found = [(expected, actual) for expected, actual in matches if actual is not None]
        extra_roles = [
            role
            for role in ctx.output.experiences
            if _find_role(role, expected_roles) is None
            and not any(loosely_equal(role.company, name) for name in ambiguous_names)
        ]
        return {
            "experience_recall": fraction(len(found), len(expected_roles)),
            "experience_precision": fraction(
                len(ctx.output.experiences) - len(extra_roles), len(ctx.output.experiences)
            ),
            "experience_dates": fraction(
                sum(_same_dates(expected, actual) for expected, actual in found), len(found)
            ),
        }


@dataclass
class SectionRecall(Evaluator[str, ParsedResume, dict[str, Any]]):
    """Checks that labelled educations, projects, skills, and email were extracted."""

    def evaluate(self, ctx: ResumeContext) -> dict[str, float]:
        """Scores the share of each labelled section found in the output."""
        expected = ctx.expected_output or ParsedResume()
        output = ctx.output
        return {
            "education_recall": _recall(
                [item.institution for item in expected.educations],
                [item.institution for item in output.educations],
            ),
            "project_recall": _recall(
                [item.name for item in expected.projects], [item.name for item in output.projects]
            ),
            "skill_recall": _recall(
                [item.name for item in expected.skills], [item.name for item in output.skills]
            ),
            "contact_email": float(
                (expected.contact.email or "").lower() == (output.contact.email or "").lower()
            ),
        }


@dataclass
class WarnsWhenAmbiguous(Evaluator[str, ParsedResume, dict[str, Any]]):
    """For cases with `expects_warning: true`, the agent must say what it was unsure about."""

    def evaluate(self, ctx: ResumeContext) -> dict[str, float]:
        """Scores 1 if a warning was raised when one is expected; skips other cases."""
        if not (ctx.metadata or {}).get("expects_warning"):
            return {}
        return {"warns_when_ambiguous": float(bool(ctx.output.parsing_warnings))}


RESUME_PARSING_EVALUATORS = [SourceFaithfulness, ExperienceMatch, SectionRecall, WarnsWhenAmbiguous]


def _share_in_source(values: list[str], source_text: str) -> float:
    """Share of values that appear (normalised) in the source text."""
    return fraction(sum(appears_in(value, source_text) for value in values), len(values))


def _find_role(
    role: ParsedExperience, candidates: list[ParsedExperience]
) -> ParsedExperience | None:
    """Returns the candidate at the same company, if any."""
    return next((item for item in candidates if loosely_equal(item.company, role.company)), None)


def _same_dates(expected: ParsedExperience, actual: ParsedExperience) -> bool:
    """True when start date, end date, and the current-role flag all match."""
    return (expected.start_date, expected.end_date, expected.is_current) == (
        actual.start_date,
        actual.end_date,
        actual.is_current,
    )


def _recall(expected_names: list[str], output_names: list[str]) -> float:
    """Share of expected names loosely matched by some output name."""
    found = sum(
        any(loosely_equal(expected, output) for output in output_names)
        for expected in expected_names
    )
    return fraction(found, len(expected_names))
