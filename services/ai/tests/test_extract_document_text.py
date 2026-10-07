"""
Description: Tests for turning uploaded DOCX files into text.
Index:
    - test_*: one behavior per test
"""

import pytest

from documents.extract_document_text import (
    DOCX_CONTENT_TYPE,
    DocumentTooLongError,
    UnsupportedDocumentError,
    extract_document_text,
)
from tests.fakes import build_docx_bytes
from text_limits import MAX_PDF_PAGES, MAX_RESUME_TEXT


def test_docx_text_includes_paragraphs_and_table_cells() -> None:
    """Resumes laid out with tables still yield all their text."""
    file_bytes = build_docx_bytes(["Jane Doe", "Experience"], table_rows=[["Acme", "2021 - 2023"]])

    text = extract_document_text(file_bytes, DOCX_CONTENT_TYPE)

    assert text.splitlines() == ["Jane Doe", "Experience", "Acme", "2021 - 2023"]


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
