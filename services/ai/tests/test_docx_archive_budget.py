"""Reject compressed upload bombs before python-docx expands their contents."""

from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

from documents.extract_document_text import (
    DOCX_CONTENT_TYPE,
    DocumentTooLongError,
    extract_document_text,
)


@pytest.mark.parametrize("many_parts", [False, True])
def test_rejects_oversized_docx_package(many_parts):
    data = BytesIO()
    with ZipFile(data, "w", compression=ZIP_DEFLATED) as archive:
        if many_parts:
            for index in range(1001):
                archive.writestr(f"part{index}", b"")
        else:
            archive.writestr("word/unused.bin", b"x" * (20 * 1024 * 1024 + 1))
    assert len(data.getvalue()) < 5 * 1024 * 1024
    with pytest.raises(DocumentTooLongError):
        extract_document_text(data.getvalue(), DOCX_CONTENT_TYPE)
