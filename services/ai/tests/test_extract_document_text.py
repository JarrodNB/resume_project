"""Check resume text extraction, document order, links, lists, and import limits."""

from io import BytesIO

import pytest
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from documents.extract_document_text import (
    DOCX_CONTENT_TYPE,
    DocumentTooLongError,
    UnsupportedDocumentError,
    _extract_pdf_page,
    extract_document_text,
)
from tests.fakes import build_docx_bytes
from text_limits import MAX_PDF_PAGES, MAX_RESUME_TEXT


def test_docx_text_includes_paragraphs_and_table_cells() -> None:
    """Resumes laid out with tables still yield all their text."""
    file_bytes = build_docx_bytes(["Jane Doe", "Experience"], table_rows=[["Acme", "2021 - 2023"]])

    text = extract_document_text(file_bytes, DOCX_CONTENT_TYPE)

    assert text.splitlines() == ["Jane Doe", "Experience", "Acme", "2021 - 2023"]


def test_docx_text_preserves_list_bullet_markers_for_exact_highlight_mapping() -> None:
    document = Document()
    document.add_paragraph("Built a reliable API", style="List Bullet")
    buffer = BytesIO()
    document.save(buffer)

    text = extract_document_text(buffer.getvalue(), DOCX_CONTENT_TYPE)

    assert text == "• Built a reliable API"


def test_docx_text_keeps_tables_between_surrounding_paragraphs() -> None:
    """Table-based job details stay under their original section heading."""
    document = Document()
    document.add_paragraph("Experience")
    table = document.add_table(rows=1, cols=2)
    table.cell(0, 0).text = "Example Company"
    table.cell(0, 1).text = "Software Engineer"
    document.add_paragraph("Education")
    table = document.add_table(rows=1, cols=1)
    table.cell(0, 0).text = "Example University"
    document.add_paragraph("Skills")
    buffer = BytesIO()
    document.save(buffer)

    text = extract_document_text(buffer.getvalue(), DOCX_CONTENT_TYPE)

    assert text.splitlines() == [
        "Experience",
        "Example Company",
        "Software Engineer",
        "Education",
        "Example University",
        "Skills",
    ]


def test_docx_text_detects_numbering_metadata_on_normal_style_paragraph() -> None:
    document = Document()
    paragraph = document.add_paragraph("Built a reliable API")
    num_properties = OxmlElement("w:numPr")
    level = OxmlElement("w:ilvl")
    level.set(qn("w:val"), "0")
    number_id = OxmlElement("w:numId")
    number_id.set(qn("w:val"), "1")
    num_properties.append(level)
    num_properties.append(number_id)
    paragraph._p.get_or_add_pPr().append(num_properties)
    buffer = BytesIO()
    document.save(buffer)

    text = extract_document_text(buffer.getvalue(), DOCX_CONTENT_TYPE)

    assert text == "• Built a reliable API"


def test_docx_text_includes_hyperlink_label_and_url() -> None:
    """A labelled DOCX hyperlink keeps both the visible text and destination."""
    document = Document()
    paragraph = document.add_paragraph("Find me on ")
    relationship_id = paragraph.part.relate_to(
        "https://github.com/jane",
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink",
        is_external=True,
    )
    hyperlink = OxmlElement("w:hyperlink")
    hyperlink.set(qn("r:id"), relationship_id)
    run = OxmlElement("w:r")
    text_node = OxmlElement("w:t")
    text_node.text = "GitHub"
    run.append(text_node)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    buffer = BytesIO()
    document.save(buffer)

    text = extract_document_text(buffer.getvalue(), DOCX_CONTENT_TYPE)

    assert "Find me on GitHub" in text
    assert '[hyperlink label="GitHub" url="https://github.com/jane"]' in text

def test_pdf_text_uses_only_the_link_label_from_a_broad_contact_fragment() -> None:
    """A URI annotation does not use the entire contact line as its visible label."""
    contact_line = "Atlanta, Georgia · 770 - 202 - 0267 JarrodNBailey@gmail.com · LinkedIn ·"

    class Reference:
        """A small indirect-object stand-in for one PDF annotation."""

        def get_object(self) -> dict[str, object]:
            """Returns an external LinkedIn annotation over part of the contact line."""
            return {
                "/A": {"/URI": "https://www.linkedin.com/in/jarrod-bailey-68w"},
                "/Rect": [300, 8, 360, 24],
            }

    class Page(dict[str, object]):
        """A page whose extractor emits the whole contact line as one text fragment."""

        def __init__(self) -> None:
            super().__init__({"/Annots": [Reference()]})

        def extract_text(self, visitor_text: object) -> str:
            """Feeds the visitor the broad fragment that previously became the label."""
            visitor_text(contact_line, [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 10, 10], None, 10)
            return contact_line

    text = _extract_pdf_page(Page())

    assert (
        '[hyperlink label="LinkedIn" '
        'url="https://www.linkedin.com/in/jarrod-bailey-68w"]'
    ) in text
    assert 'hyperlink label="Atlanta, Georgia' not in text


def test_empty_docx_raises() -> None:
    """A document with no text can't be parsed."""
    with pytest.raises(UnsupportedDocumentError):
        extract_document_text(build_docx_bytes([]), DOCX_CONTENT_TYPE)


def test_docx_over_the_text_cap_is_too_long(monkeypatch: pytest.MonkeyPatch) -> None:
    """Extracted text over the import cap is a length error, not an unreadable file."""
    monkeypatch.setattr(
        "documents.extract_document_text._extract_docx_text",
        lambda _file_bytes: "a" * (MAX_RESUME_TEXT + 1),
    )

    with pytest.raises(DocumentTooLongError):
        extract_document_text(b"unused", DOCX_CONTENT_TYPE)


def test_pdf_over_the_page_cap_is_too_long(monkeypatch: pytest.MonkeyPatch) -> None:
    """A PDF with more pages than the cap is rejected before its text is joined."""

    class _Reader:
        def __init__(self, _buffer: object) -> None:
            self.pages = [object()] * (MAX_PDF_PAGES + 1)

    monkeypatch.setattr("documents.extract_document_text.PdfReader", _Reader)

    with pytest.raises(DocumentTooLongError):
        extract_document_text(b"unused", "application/pdf")


def test_unsupported_content_type_raises() -> None:
    """Only PDF and DOCX are supported."""
    with pytest.raises(UnsupportedDocumentError):
        extract_document_text(b"hello", "text/plain")
