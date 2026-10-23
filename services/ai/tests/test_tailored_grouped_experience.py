"""Keep employment groups and achievement ownership in generated resume snapshots."""
from datetime import date

from schemas.gap_analysis_context import LibraryExperience, LibraryExperienceRole, LibraryHighlight
from schemas.tailored_section import TailoredSectionDraft
from tailoring.labeled_sources import label_sources
from tailoring.materialize_section import materialize_section
from tests.fakes import build_gap_analysis_context


def grouped_context():
    context = build_gap_analysis_context()
    context.career_library.experiences = [LibraryExperience(
        id="employment", company="Example", roles=[
            LibraryExperienceRole(id="senior", title="Senior Engineer", start_date=date(2025, 1, 1)),
            LibraryExperienceRole(id="junior", title="Engineer", start_date=date(2020, 1, 1), end_date=date(2024, 12, 1)),
        ], highlights=[
            LibraryHighlight(id="shared", content="Built tools"),
            LibraryHighlight(id="scoped", content="Led migrations", experience_role_id="senior"),
        ],
    )]
    return context


def test_materialization_keeps_grouped_roles_and_shared_achievement_once():
    context = grouped_context()
    sources = label_sources(context, [], [], None, "experience")
    draft = TailoredSectionDraft.model_validate({"nothing_fits": False, "entries": [{"label": "E1", "prose": [
        {"text": "Built tools", "source_labels": ["H1"]},
        {"text": "Led migrations", "source_labels": ["E1", "H2"]},
    ]}]})
    item = materialize_section("experience", draft, context.career_library, sources)["items"][0]
    assert item["highlights"] == ["Built tools"]
    assert [(role["title"], role["start_date"]) for role in item["roles"]] == [
        ("Senior Engineer", "2025-01"), ("Engineer", "2020-01")]
    assert item["roles"][0]["highlights"] == ["Led migrations"]
    assert item["roles"][1]["highlights"] == []
    assert item["source_experience_id"] == "employment"
    assert item["highlight_source_ids"] == [["shared"]]


def test_grouped_source_renders_and_screens_role_identity():
    sources = label_sources(grouped_context(), [], [], None, "experience")
    source = sources.records["E1"]
    assert "Senior Engineer" in source.text
    assert "2025-01" in source.text
    assert source.provenance.used_fields["experience_role"] == {"title", "start_date", "end_date", "description"}
    assert "Shared" in sources.records["H1"].text
    assert "Senior Engineer" in sources.records["H2"].text


def test_checker_rejects_achievement_from_another_employment_entry():
    from tailoring.check_section_faithfulness import find_section_problems
    context = grouped_context()
    context.career_library.experiences.append(LibraryExperience(
        id="other", company="Example", title="Engineer", highlights=[LibraryHighlight(id="other-h", content="Built pipelines")]))
    sources = label_sources(context, [], [], None, "experience")
    draft = TailoredSectionDraft.model_validate({"nothing_fits": False, "entries": [{"label": "E1", "prose": [
        {"text": "Built pipelines", "source_labels": ["H3"]},
    ]}]})
    assert any("another experience" in problem for problem in find_section_problems("experience", draft, sources))


def test_mixed_shared_and_role_citations_remain_shared():
    context = grouped_context()
    sources = label_sources(context, [], [], None, "experience")
    draft = TailoredSectionDraft.model_validate({"nothing_fits": False, "entries": [{"label": "E1", "prose": [
        {"text": "Built tools and led migrations", "source_labels": ["H1", "H2"]},
    ]}]})
    item = materialize_section("experience", draft, context.career_library, sources)["items"][0]
    assert item["highlights"] == ["Built tools and led migrations"]
    assert all(role["highlights"] == [] for role in item["roles"])


def test_selected_highlight_provenance_includes_copied_descriptions():
    context = grouped_context()
    experience = context.career_library.experiences[0]
    experience.description = "Company work"
    experience.roles[0].description = "Senior work"
    sources = label_sources(context, [], [], None, "experience")
    provenance = sources.records["H1"].provenance
    assert "description" in provenance.used_fields["experience"]
    assert "description" in provenance.used_fields["experience_role"]
    assert "Senior work" in sources.records["H1"].text


def test_checker_rejects_repeating_one_employment_as_multiple_entries():
    from tailoring.check_section_faithfulness import find_section_problems
    sources = label_sources(grouped_context(), [], [], None, "experience")
    draft = TailoredSectionDraft.model_validate({"nothing_fits": False, "entries": [{"label": "E1"}, {"label": "E1"}]})
    assert any("once" in problem for problem in find_section_problems("experience", draft, sources))


def test_summary_source_includes_roles_but_not_internal_snapshot_evidence_ids():
    context = grouped_context()
    sources = label_sources(context, [], [], None, "experience")
    draft = TailoredSectionDraft.model_validate({"nothing_fits": False, "entries": [{"label": "E1"}]})
    content = materialize_section("experience", draft, context.career_library, sources)
    summary_sources = label_sources(context, [], [{"title": "Experience", "content": content}], None, "summary")
    assert "Senior Engineer" in summary_sources.records["A1"].text
    assert "employment" not in summary_sources.records["A1"].text
    assert "senior" not in summary_sources.records["A1"].text
