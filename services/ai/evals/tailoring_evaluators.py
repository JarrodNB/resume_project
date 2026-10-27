"""
Evaluate whether a tailored section is relevant and omits sections when expected.

These scores describe selection and wording against synthetic cases; they do not
judge whether every claim in the prose is supported.
Index:
    - TailorEvalInput / TailorEvalLabels: one case
    - SectionRelevance / OmitsWhenAsked: the scores
    - labels_to_draft: the draft the hand labels describe
    - TAILORING_EVALUATORS: the classes Dataset.from_file needs
"""

from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from documents.text_matching import normalize_text
from schemas.gap_analysis_context import GapAnalysisContext
from schemas.tailored_section import ChosenEntry, CitedProse, TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from tailoring.section_catalog import WRITTEN_SECTIONS


class TailorEvalInput(BaseModel):
    """One production-generated section, against a synthetic library."""

    section_type: str
    context: GapAnalysisContext

    @field_validator("section_type")
    @classmethod
    def generated_section(cls, value: str) -> str:
        """Keep copied sections out of paid writer evaluations."""
        if value not in WRITTEN_SECTIONS:
            raise ValueError("Tailoring evals require a generated section")
        return value


class TailorEvalLabels(BaseModel):
    """Expected selection and job terms for a synthetic section case."""

    nothing_fits: bool
    entry_label: str | None = None
    prose: str | None = None
    source_labels: list[str] = Field(default_factory=list)
    job_terms: list[str] = Field(default_factory=list)


TailorContext = EvaluatorContext[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels]


def labels_to_draft(labels: TailorEvalLabels) -> TailoredSectionDraft:
    """The draft a perfect run would return for these labels."""
    if labels.nothing_fits:
        return TailoredSectionDraft(nothing_fits=True)
    if labels.entry_label is None:
        return TailoredSectionDraft(
            nothing_fits=False,
            summary=CitedProse(text=labels.prose or "", source_labels=labels.source_labels),
        )
    prose: list[CitedProse] = []
    if labels.prose or labels.source_labels:
        prose = [CitedProse(text=labels.prose or "", source_labels=labels.source_labels)]
    return TailoredSectionDraft(
        nothing_fits=False,
        entries=[ChosenEntry(label=labels.entry_label, prose=prose)],
    )


def _sources(ctx: TailorContext):
    """The complete labeled library the checker uses."""
    prompt = build_section_prompt(
        ctx.inputs.section_type,
        ctx.inputs.context,
        [],
        [],
        write_anyway=False,
        gap_analysis=None,
    )
    return prompt.sources


@dataclass
class SectionRelevance(Evaluator[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels]):
    """A written section addresses the job. A skill has no prose, so its chosen names count."""

    def evaluate(self, ctx: TailorContext) -> float:
        """1 when an omitted section was supposed to be omitted, or the wording hits a job term."""
        labels = ctx.metadata
        assert labels is not None
        if labels.nothing_fits:
            return 1.0 if ctx.output.nothing_fits else 0.0
        haystack = normalize_text(_relevance_text(ctx))
        return 1.0 if any(normalize_text(term) in haystack for term in labels.job_terms) else 0.0


@dataclass
class OmitsWhenAsked(Evaluator[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels]):
    """The model leaves out a section that does not fit."""

    def evaluate(self, ctx: TailorContext) -> float:
        """1 when nothing_fits matches the label."""
        labels = ctx.metadata
        assert labels is not None
        return 1.0 if ctx.output.nothing_fits == labels.nothing_fits else 0.0


def _prose_texts(draft: TailoredSectionDraft) -> list[str]:
    """Every sentence the draft wrote."""
    texts = [draft.summary.text] if draft.summary else []
    texts += [prose.text for entry in draft.entries for prose in entry.prose]
    return texts


def _relevance_text(ctx: TailorContext) -> str:
    """Prose when the section wrote any. Otherwise the text of the chosen entry labels."""
    prose = " ".join(_prose_texts(ctx.output))
    if prose.strip():
        return prose
    return _sources(ctx).text_for([entry.label for entry in ctx.output.entries])


TAILORING_EVALUATORS = (SectionRelevance, OmitsWhenAsked)
