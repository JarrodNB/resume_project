"""
Description: Extracts plain text from uploaded resume files (PDF and DOCX).
Index:
    - PDF_CONTENT_TYPE / DOCX_CONTENT_TYPE: supported MIME types
    - UnsupportedDocumentError: raised for other file types or files with no text
    - DocumentTooLongError: raised when the page count or extracted text is over the import cap
    - extract_document_text: returns the text of a file given its bytes and content type
"""

from io import BytesIO

from docx import Document
from pypdf import PdfReader

from text_limits import MAX_PDF_PAGES, MAX_RESUME_TEXT

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class UnsupportedDocumentError(Exception):
    """The file can't be turned into text (wrong type, or a scanned PDF with no text layer)."""


class DocumentTooLongError(Exception):
    """The file has too many pages or too much text to import."""


def extract_document_text(file_bytes: bytes, content_type: str) -> str:
    """Returns the file's text. Raises UnsupportedDocumentError if there is none, and
    DocumentTooLongError when the page count or the text is over the import cap."""
    if content_type == PDF_CONTENT_TYPE:
        text = _extract_pdf_text(file_bytes)
    elif content_type == DOCX_CONTENT_TYPE:
        text = _extract_docx_text(file_bytes)
    else:
        raise UnsupportedDocumentError(f"Unsupported file type: {content_type}")

    if len(text) > MAX_RESUME_TEXT:
        raise DocumentTooLongError("The file's text is over the import cap")
    if not text.strip():
        raise UnsupportedDocumentError("The file contains no extractable text")
    return text


def _extract_pdf_text(file_bytes: bytes) -> str:
    """Joins the text layer of every PDF page. Stops before reading page text past the cap."""
    reader = PdfReader(BytesIO(file_bytes))
    if len(reader.pages) > MAX_PDF_PAGES:
        raise DocumentTooLongError("The file has too many pages")
    return "\n\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx_text(file_bytes: bytes) -> str:
    """Joins DOCX paragraphs, then table cells (resumes often use tables for layout)."""
    document = Document(BytesIO(file_bytes))
    lines = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            lines.extend(cell.text for cell in row.cells)
    return "\n".join(lines)
