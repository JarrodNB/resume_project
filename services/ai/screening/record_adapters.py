"""Turn the snapshots Rails sends into `ScreenableRecord`s for `screening.records`.

Each function only reshapes data: it does not screen, read the session, or approve
anything. Record types, ids and field names match what the older per-domain modules
reported, so Rails approvals stay compatible. Saved `screened_fields` become
`approved_fields`; display titles are the user's own text, shortened, for error messages.
"""

import re
from collections.abc import Iterable, Mapping, Sequence
from collections.abc import Set as AbstractSet

from schemas.gap_analysis_context import CareerLibrary, JobToAnalyze
from schemas.gap_response import GapResponseSnapshot
from schemas.summary_generation import SummarySource
from screening.records import ScreenableRecord

JOB_FIELDS = ("title", "company", "requirements", "nice_to_haves")
_LIBRARY_SECTIONS = (("experiences", "experience"), ("projects", "project"), ("educations", "education"),
                     ("certifications", "certification"), ("skills", "skill"),
                     ("career_contexts", "career_context"))
_TITLE_CHARACTERS = 60
_SUMMARY_SECTIONS = {"EXPERIENCES": "experience", "PROJECTS": "project", "EDUCATIONS": "education",
                     "CERTIFICATIONS": "certification", "SKILLS": "skill",
                     "CAREER_CONTEXTS": "career_context"}
_PROFILE_LABEL = re.compile(rf"^({'|'.join(_SUMMARY_SECTIONS)})_(\d+)_(.+)$")
_RESUME_LABEL = re.compile(r"^(SECTION_\d+_ITEM_\d+)_(.+)$")
_HIGHLIGHT = re.compile(r"^HIGHLIGHT_\d+$")


def library_records(
    library: CareerLibrary, *, used_fields: Mapping[str, AbstractSet[str]] | None = None,
    include_context_requirements: bool = True,
) -> list[ScreenableRecord]:
    """One record per summary, entry and highlight that has text the caller uses.

    Eligible fields are non-blank strings other than `*_precision`. `used_fields` maps
    record types to the fields a prompt builder uses; None means every eligible field.
    """
    records = []

    def add(record_type, record_id, values, approved, title):
        fields = {name: value for name, value in values.items()
                  if isinstance(value, str) and value.strip() and not name.endswith("_precision")
                  and (used_fields is None or name in used_fields.get(record_type, set()))}
        if fields:
            records.append(ScreenableRecord(record_type=record_type, record_id=record_id or None,
                fields=fields, display_title=title, approved_fields=frozenset(approved)))

    add("user", library.summary_record_id, {"summary": library.summary}, library.screened_fields,
        "Profile summary")
    for section, record_type in _LIBRARY_SECTIONS:
        for record in getattr(library, section):
            values = record.model_dump(exclude={"id", "highlights"})
            if section == "career_contexts" and not include_context_requirements:
                values.pop("requirement", None)
            add(record_type, record.id, values, record.screened_fields, _library_title(record_type, record))
            for highlight in getattr(record, "highlights", []):
                add("experience_highlight", highlight.id, {"content": highlight.content},
                    highlight.screened_fields, f"Highlight in {_library_title(record_type, record)}")
    return records


def job_records(job: JobToAnalyze, *, fields: Sequence[str] = JOB_FIELDS) -> list[ScreenableRecord]:
    """The saved job's used fields as one record; lists stay whole, ordered lists."""
    title = f"Job: {job.title} at {job.company}" if job.company else f"Job: {job.title}"
    return [ScreenableRecord(record_type="job", record_id=job.id,
        fields={name: getattr(job, name) for name in fields}, display_title=_short(title),
        approved_fields=frozenset(job.screened_fields))]


def gap_response_records(snapshots: Iterable[GapResponseSnapshot]) -> list[ScreenableRecord]:
    """One record per saved answer. Legacy snapshots without an id never reuse saved checks."""
    return [ScreenableRecord(record_type="gap_response", record_id=snapshot.id or None,
        fields={"requirement": snapshot.requirement, "body": snapshot.body},
        display_title=_short(snapshot.requirement) or "Saved gap response",
        approved_fields=frozenset(snapshot.screened_fields if snapshot.id else ()))
        for snapshot in snapshots]


def interview_answer_record(snapshot: Mapping | None, field: str, text: str) -> ScreenableRecord:
    """One practice question field, tied to the question and answer revisions Rails queued.

    `snapshot` holds `question_id`, `question_revision`, optional `answer_revision`,
    `screened_fields` and, for the title, `question_text`. None screens without reporting.
    """
    if snapshot is None:
        return ScreenableRecord(record_type="interview_question", record_id=None, fields={field: text},
                                display_title="Your answer" if field == "answer_text" else _short(text))
    revision = {"question_revision": snapshot["question_revision"]}
    if field == "answer_text":
        revision["answer_revision"] = snapshot.get("answer_revision")
    question = _short(str(snapshot.get("question_text") or ""))
    title = (f"Your answer to: {question}" if question else "Your answer") if field == "answer_text" else question
    return ScreenableRecord(record_type="interview_question", record_id=str(snapshot["question_id"]),
        fields={field: text}, display_title=title or "Practice question",
        approved_fields=frozenset({field} & set(snapshot.get("screened_fields", []))),
        revision={key: value for key, value in revision.items() if value is not None})


def summary_source_records(sources: Iterable[SummarySource]) -> list[ScreenableRecord]:
    """Group summary-generation sources by the saved row they came from.

    Library sources carry the record type, id and field Rails froze, so they report
    receipts for Rails to check against the snapshot. Saved-resume sections are copies,
    not library rows: they use the unsaved `resume_section` type, have no id and are never
    reported. Older snapshots without ids are grouped by label position and not reported.
    """
    groups: dict[object, dict] = {}
    for source in sources:
        if not source.text.strip():
            continue
        if source.record_id is not None:
            key, record_type, field = (source.record_type, source.record_id), source.record_type, source.field
        else:
            key, record_type, field = _summary_key(source.label)
        group = groups.setdefault(key, {"type": record_type, "id": source.record_id, "fields": {}, "approved": set()})
        group["fields"][field] = source.text
        if source.screened:
            group["approved"].add(field)
    return [ScreenableRecord(record_type=group["type"], record_id=group["id"], fields=group["fields"],
                             display_title=_short(next(iter(group["fields"].values()))),
                             approved_fields=frozenset(group["approved"]))
            for group in groups.values()]


def _summary_key(label):
    """Return the entry key, record type and field name a summary label refers to."""
    if match := _PROFILE_LABEL.match(label):
        section, number, rest = match.groups()
        if _HIGHLIGHT.match(rest):
            return label, "experience_highlight", "content"
        return f"{section}_{number}", _SUMMARY_SECTIONS[section], rest.lower()
    if match := _RESUME_LABEL.match(label):
        prefix, rest = match.groups()
        if _HIGHLIGHT.match(rest):
            return label, "resume_section", "highlight"
        return prefix, "resume_section", rest.lower()
    return label, "resume_section", "text"


def _library_title(record_type, record):
    if record_type == "experience":
        return _short(f"{record.title} at {record.company}")
    if record_type == "education":
        return _short(f"{record.degree} at {record.institution}" if record.degree else record.institution)
    if record_type == "career_context":
        return _short(record.requirement)
    return _short(record.name)


def _short(text):
    text = " ".join(text.split())
    return text if len(text) <= _TITLE_CHARACTERS else text[:_TITLE_CHARACTERS - 1].rstrip() + "…"
