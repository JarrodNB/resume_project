"""Real PDF streams exercise extraction and loss through the public inspector."""

from io import BytesIO

import pytest
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from documents.ats_pdf import inspect_pdf


def pdf_bytes(*pages, leading=14):
    writer = PdfWriter()
    for lines in pages:
        page = writer.add_blank_page(width=612, height=792)
        font = DictionaryObject(
            {
                NameObject("/Type"): NameObject("/Font"),
                NameObject("/Subtype"): NameObject("/Type1"),
                NameObject("/BaseFont"): NameObject("/Helvetica"),
            }
        )
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
        )
        content = DecodedStreamObject()
        content.set_data(
            (
                f"BT /F1 11 Tf 40 600 Td {leading} TL "
                + " ".join(
                    "(" + line.replace("(", r"\(").replace(")", r"\)") + ") Tj T*" for line in lines
                )
                + " ET"
            ).encode("latin1")
        )
        page[NameObject("/Contents")] = writer._add_object(content)
    out = BytesIO()
    writer.write(out)
    return out.getvalue()


def sections():
    return [
        {
            "id": "summary",
            "section_type": "summary",
            "title": "Summary",
            "content": {"text": "Ruby developer builds reliable systems"},
        }
    ]


def test_actual_pdf_text_is_compared_with_saved_content():
    result = inspect_pdf(
        pdf_bytes(["SUMMARY", "Ruby developer builds reliable systems"]), sections()
    )
    assert all(check["ratio"] == 1 for check in result["checks"])
    assert result["checks"][0]["evidence"][0]["page"] == 1


def test_missing_words_and_changed_characters_reduce_their_checks():
    result = inspect_pdf(pdf_bytes(["SUMMARY", "Ruby deve1oper builds"]), sections())
    checks = {c["key"]: c for c in result["checks"]}
    assert checks["coverage"]["ratio"] < 0.9
    assert checks["characters"]["ratio"] < 0.9
    assert checks["boundaries"]["ratio"] < 1


def test_reordered_sections_have_complete_coverage_but_bad_reading_order():
    source = sections() + [
        {
            "id": "skills",
            "section_type": "skills",
            "title": "Skills",
            "content": {"items": [{"name": "Python"}]},
        }
    ]
    checks = {
        c["key"]: c
        for c in inspect_pdf(
            pdf_bytes(["Skills", "Python", "Summary", "Ruby developer builds reliable systems"]),
            source,
        )["checks"]
    }
    assert checks["coverage"]["ratio"] == 1
    assert checks["reading_order"]["ratio"] < 0.9


def test_wrapping_and_multiple_pages_preserve_content():
    result = inspect_pdf(
        pdf_bytes(["Summary", "Ruby developer builds"], ["reliable systems"]), sections()
    )
    assert result["page_count"] == 2
    assert all(c["ratio"] == 1 for c in result["checks"])
    assert result["checks"][0]["evidence"][1]["page"] == 2


@pytest.mark.parametrize("data", [b"broken", b"%PDF-1.4 corrupt", pdf_bytes([""])])
def test_uninspectable_files_fail_without_a_score(data):
    with pytest.raises(ValueError):
        inspect_pdf(data, sections())


def test_worker_binds_owned_snapshot_and_downloaded_digest_without_model_calls():
    from hashlib import sha256
    from types import SimpleNamespace
    from uuid import uuid4

    from schemas.ats_content import Snapshot
    from worker.ats_pdf_handler import handle_ats_pdf_task
    from worker.queue_messages import AiTaskMessage

    data = pdf_bytes(["Summary", "Ruby developer builds reliable systems"])
    task_id, user_id, run_id, resume_id = (uuid4() for _ in range(4))
    identity = {
        "run_id": str(run_id),
        "resume_id": str(resume_id),
        "content_fingerprint": "saved",
        "rubric_version": "ats-v1",
        "renderer_version": "resume-pdf-v1",
        "digest": sha256(data).hexdigest(),
    }
    snapshot = Snapshot(
        resume_id=str(resume_id),
        content_snapshot=sections(),
        job_snapshot={},
        content_fingerprint="saved",
        job_fingerprint="job",
        rubric_version="ats-v1",
        pdf_result={**identity, "task_id": str(task_id)},
    )
    reads = []

    def read(owner, run):
        reads.append((owner, run))
        return snapshot

    dependencies = SimpleNamespace(
        read_ats_snapshot=read, file_storage=SimpleNamespace(download_file=lambda key: data)
    )
    task = AiTaskMessage(
        ai_task_id=task_id,
        user_id=user_id,
        task_type="check_resume_pdf",
        input={**identity, "source_file": {"key": "owned-blob"}},
    )
    result = handle_ats_pdf_task(task, dependencies)
    assert result.status == "completed"
    assert result.usage == []
    assert result.result["digest"] == identity["digest"]
    assert reads == [(user_id, str(run_id))]
    task.input["digest"] = "changed"
    assert handle_ats_pdf_task(task, dependencies).status == "failed"
    task.input["digest"] = identity["digest"]
    dependencies.file_storage.download_file = lambda key: data + b"tampered"
    assert handle_ats_pdf_task(task, dependencies).status == "failed"
    snapshot.pdf_result["task_id"] = str(uuid4())
    assert handle_ats_pdf_task(task, dependencies).status == "failed"


def test_visual_backward_jumps_are_exposed_with_coordinates():
    result = inspect_pdf(
        pdf_bytes(["Summary", "Ruby developer builds reliable systems"], leading=-40), sections()
    )
    order = next(c for c in result["checks"] if c["key"] == "reading_order")
    assert order["ratio"] < 0.9
    assert all("x" in item and "y" in item for item in order["evidence"])


def test_saved_string_links_are_expected_visible_content():
    from documents.ats_pdf import expected_chunks

    source = [
        {
            "section_type": "contact",
            "content": {
                "full_name": "Jane",
                "links": [
                    "github.com/jane",
                    {"label": "LinkedIn", "url": "https://linkedin.com/in/jane"},
                ],
            },
        }
    ]
    assert expected_chunks(source) == ["Jane", "github.com/jane", "LinkedIn"]
