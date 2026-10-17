"""Validate ATS judgments against immutable saved resume text; Rails calculates scores."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CHECK_KEYS = (
    "contact_usability",
    "section_labels",
    "role_employer",
    "dates",
    "experience_clarity",
    "claim_evidence",
    "concise_writing",
    "organization",
    "repetition",
    "placeholders",
)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Evidence(StrictModel):
    section_id: str
    excerpt: str = Field(min_length=1)


class RequirementAssessment(StrictModel):
    requirement_id: str
    status: Literal["covered", "partial", "missing"]
    evidence: list[Evidence]
    explanation: str = Field(min_length=1)
    suggested_action: str
    severity: Literal["info", "warning", "error"] = "warning"
    absence_reason: str | None = None


class ContentCheck(StrictModel):
    key: Literal[
        "contact_usability",
        "section_labels",
        "role_employer",
        "dates",
        "experience_clarity",
        "claim_evidence",
        "concise_writing",
        "organization",
        "repetition",
        "placeholders",
    ]
    status: Literal["pass", "partial", "fail", "unavailable"]
    evidence: list[Evidence]
    explanation: str = Field(min_length=1)
    suggested_action: str
    severity: Literal["info", "warning", "error"] = "warning"
    absence_reason: str | None = None


class Assessment(StrictModel):
    requirements: list[RequirementAssessment]
    checks: list[ContentCheck]


class Snapshot(StrictModel):
    resume_id: str
    content_snapshot: list[dict]
    job_snapshot: dict | None
    content_fingerprint: str
    job_fingerprint: str | None
    rubric_version: str


def validate_assessment(assessment, sections, requirements):
    """Reject omitted/duplicate rubric items and quotations absent from their section."""
    ids = [item.requirement_id for item in assessment.requirements]
    keys = [item.key for item in assessment.checks]
    if sorted(ids) != sorted(str(item["id"]) for item in requirements) or sorted(keys) != sorted(
        CHECK_KEYS
    ):
        raise ValueError("Incomplete or duplicate rubric coverage")
    sources = {
        str(section.get("id", section.get("position"))): list(
            _text_values({"title": section.get("title"), "content": section.get("content")})
        )
        for section in sections
    }
    for item in [*assessment.requirements, *assessment.checks]:
        for evidence in item.evidence:
            if evidence.section_id not in sources or not any(
                evidence.excerpt in value for value in sources[evidence.section_id]
            ):
                raise ValueError("Invalid resume evidence")
        if (
            isinstance(item, RequirementAssessment)
            and item.status != "missing"
            and not item.evidence
        ):
            raise ValueError("Covered requirements require evidence")
    for item in assessment.checks:
        if (
            item.status != "unavailable"
            and not item.evidence
            and not (
                item.status == "fail"
                and item.key in ("contact_usability", "section_labels")
                and item.absence_reason
                and item.absence_reason.strip()
            )
        ):
            raise ValueError("Applicable checks require evidence")
    for item in assessment.checks:
        if not item.evidence and item.status == "fail" and item.absence_reason:
            if item.key == "section_labels" and any(
                str(section.get("title") or "").strip() for section in sections
            ):
                raise ValueError("Section label absence contradicts snapshot")
            if item.key == "contact_usability" and any(
                section.get("section_type", section.get("type")) == "contact"
                and list(_text_values(section.get("content")))
                for section in sections
            ):
                raise ValueError("Contact absence contradicts snapshot")
    return assessment


def _text_values(value):
    """Keep exact source strings, without JSON escaping or field-name evidence."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for child in value.values():
            yield from _text_values(child)
    elif isinstance(value, list):
        for child in value:
            yield from _text_values(child)
