"""Select exact saved snippets by reference, then restore the public ATS assessment shape.

The catalog includes only section titles and content strings, with their source paths.
Splitting preserves every character and keeps opaque privacy tokens within whole words.
"""

import re
from typing import Literal

from pydantic import Field

from schemas.ats_content import Assessment, Snapshot, StrictModel, validate_assessment


class EvidenceSnippet(StrictModel):
    id: str
    section_id: str
    field_path: str
    excerpt: str


class SelectionItem(StrictModel):
    evidence_ids: list[str] = Field(
        description="Select IDs from the supplied evidence_catalog; never write quotations or invent IDs."
    )
    explanation: str = Field(min_length=1)
    suggested_action: str
    severity: Literal["info", "warning", "error"] = "warning"
    absence_reason: str | None = None


class RequirementSelection(SelectionItem):
    requirement_id: str
    status: Literal["covered", "partial", "missing"]


class CheckSelection(SelectionItem):
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


class AssessmentSelection(StrictModel):
    requirements: list[RequirementSelection]
    checks: list[CheckSelection]


class AssessmentContext(StrictModel):
    snapshot: Snapshot
    evidence_catalog: list[EvidenceSnippet]


def build_evidence_catalog(sections):
    """Index exact contiguous source strings without silently truncating any leaf."""
    catalog = []
    for section in sections:
        section_id = str(section.get("id", section.get("position")))
        for path, value in _leaves(
            {"title": section.get("title"), "content": section.get("content")}
        ):
            for snippet in _snippets(value):
                catalog.append(
                    EvidenceSnippet(
                        id=f"e{len(catalog):06d}",
                        section_id=section_id,
                        field_path=path,
                        excerpt=snippet,
                    )
                )
    return catalog


def _leaves(value, path=""):
    if isinstance(value, str):
        yield path, value
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from _leaves(item, f"{path}.{key}" if path else str(key))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _leaves(item, f"{path}[{index}]")


def _snippets(value):
    current = ""
    for word in re.findall(r"\S+\s*|\s+", value):
        if current and len(current) + len(word) > 240:
            yield current
            current = ""
        current += word
    if current:
        yield current


def expand_assessment(selection: AssessmentSelection, context: AssessmentContext) -> Assessment:
    catalog = {item.id: item for item in context.evidence_catalog}
    output = selection.model_dump(mode="json")
    for item in [*output["requirements"], *output["checks"]]:
        evidence = []
        for reference in item.pop("evidence_ids"):
            if reference not in catalog:
                raise ValueError("Unknown evidence reference; select only supplied catalog IDs")
            snippet = catalog[reference]
            evidence.append({"section_id": snippet.section_id, "excerpt": snippet.excerpt})
        item["evidence"] = evidence
    assessment = Assessment.model_validate(output)
    return validate_assessment(
        assessment,
        context.snapshot.content_snapshot,
        (context.snapshot.job_snapshot or {}).get("requirements", []),
    )
