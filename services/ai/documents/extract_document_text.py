"""
Description: Extracts plain text from uploaded resume files (PDF and DOCX).
Index:
    - PDF_CONTENT_TYPE / DOCX_CONTENT_TYPE: supported MIME types
    - UnsupportedDocumentError: raised for other file types or files with no text
    - extract_document_text: returns the text of a file given its bytes and content type
"""

from io import BytesIO

from docx import Document
from pypdf import PdfReader

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class UnsupportedDocumentError(Exception):
    """The file can't be turned into text (wrong type, or a scanned PDF with no text layer)."""


def extract_document_text(file_bytes: bytes, content_type: str) -> str:
    """Returns the file's text. Raises UnsupportedDocumentError if there is none."""
    if content_type == PDF_CONTENT_TYPE:
        text = _extract_pdf_text(file_bytes)
    elif content_type == DOCX_CONTENT_TYPE:
        text = _extract_docx_text(file_bytes)
    else:
        raise UnsupportedDocumentError(f"Unsupported file type: {content_type}")

    if not text.strip():
        raise UnsupportedDocumentError("The file contains no extractable text")
    return text


def _extract_pdf_text(file_bytes: bytes) -> str:
    """Joins the text layer of every PDF page."""
    reader = PdfReader(BytesIO(file_bytes))
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx_text(file_bytes: bytes) -> str:
    """Joins DOCX paragraphs, then table cells (resumes often use tables for layout)."""
    document = Document(BytesIO(file_bytes))
    lines = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            lines.extend(cell.text for cell in row.cells)
    return "\n".join(lines)
