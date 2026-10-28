"""Malformed style inheritance must fail instead of hanging the resume worker."""

from io import BytesIO

import pytest
from docx import Document
from docx.enum.style import WD_STYLE_TYPE

from documents.extract_document_text import DOCX_CONTENT_TYPE, UnsupportedDocumentError, extract_document_text


@pytest.mark.parametrize("self_cycle", [True, False])
def test_rejects_cyclic_paragraph_styles(self_cycle):
    document = Document()
    first = document.styles.add_style("First", WD_STYLE_TYPE.PARAGRAPH)
    second = first if self_cycle else document.styles.add_style("Second", WD_STYLE_TYPE.PARAGRAPH)
    first.base_style = second
    second.base_style = first
    document.add_paragraph("Synthetic resume", style=first)
    data = BytesIO()
    document.save(data)
    with pytest.raises(UnsupportedDocumentError, match="cyclic"):
        extract_document_text(data.getvalue(), DOCX_CONTENT_TYPE)
