"""
Description: Tests for turning uploaded DOCX files into text.
Index:
    - test_*: one behavior per test
"""

import pytest

from documents.extract_document_text import (
    DOCX_CONTENT_TYPE,
    UnsupportedDocumentError,
    extract_document_text,
)
from tests.fakes import build_docx_bytes


def test_docx_text_includes_paragraphs_and_table_cells() -> None:
    """Resumes laid out with tables still yield all their text."""
    file_bytes = build_docx_bytes(["Jane Doe", "Experience"], table_rows=[["Acme", "2021 - 2023"]])

    text = extract_document_text(file_bytes, DOCX_CONTENT_TYPE)

    assert text.splitlines() == ["Jane Doe", "Experience", "Acme", "2021 - 2023"]


def test_empty_docx_raises() -> None:
    """A document with no text can't be parsed."""
    with pytest.raises(UnsupportedDocumentError):
        extract_document_text(build_docx_bytes([]), DOCX_CONTENT_TYPE)


def test_unsupported_content_type_raises() -> None:
    """Only PDF and DOCX are supported."""
    with pytest.raises(UnsupportedDocumentError):
        extract_document_text(b"hello", "text/plain")
