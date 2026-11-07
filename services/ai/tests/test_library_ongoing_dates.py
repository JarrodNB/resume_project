"""Keep unknown project and education dates distinct from explicit ongoing work.

These checks cover public model inputs and editable resume output without any paid
provider calls. Jobs retain their established null-end-date meaning.
"""

from datetime import date

import pytest

from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from model_inputs.career_library import render_career_library_sections
from model_inputs.interview_evidence import interview_career_evidence
from schemas.gap_analysis_context import (
    CareerLibrary,
    GapAnalysisContext,
    JobToAnalyze,
    LibraryEducation,
    LibraryExperience,
    LibraryProject,
)
from schemas.tailored_section import ChosenEntry, TailoredSectionDraft
from tailoring.labeled_sources import label_sources
from tailoring.materialize_section import copy_library_section, materialize_section
from worker.library_review_handler import render_review


@pytest.mark.parametrize("ongoing", [False, True])
@pytest.mark.parametrize("start", [None, date(2024, 1, 1)])
def test_saved_ongoing_status_reaches_model_inputs_and_resume(ongoing, start):
    library = CareerLibrary(
        projects=[LibraryProject(id="p", name="Current tool", start_date=start, ongoing=ongoing)],
        educations=[LibraryEducation(id="ed", institution="College", start_date=start, ongoing=ongoing)],
    )
    context = GapAnalysisContext(job=JobToAnalyze(id="job", title="Analyst"), career_library=library)
    chat = "\n".join(render_career_library_sections(library))
    interview, _ = interview_career_evidence(library)
    comparison = build_gap_analysis_prompt(context, date(2026, 11, 6)).text
    review = render_review(library)
    for rendered in (chat, interview, comparison, review):
        assert ("present" in rendered) is ongoing
    sources = label_sources(context, [], [])
    project = materialize_section("projects", TailoredSectionDraft(nothing_fits=False,
        entries=[ChosenEntry(label="P1", prose=[])]), library, sources)["items"][0]
    education = copy_library_section("education", library, sources)["items"][0]
    for item in (project, education):
        assert item["is_current"] is ongoing
        assert item["end_date"] is None
        assert item["start_date"] == ("2024-01" if start else None)


def test_legacy_missing_ongoing_does_not_invent_current_education_or_project():
    assert not LibraryProject(id="p", name="Tool").ongoing
    assert not LibraryEducation(id="ed", institution="College").ongoing
    library = CareerLibrary(experiences=[LibraryExperience(id="e", company="Co", title="Analyst", start_date=date(2024, 1, 1))])
    assert "present" in "\n".join(render_career_library_sections(library))
