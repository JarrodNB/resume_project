"""
Description: Extracts text and hyperlink labels/targets from uploaded resume files (PDF and DOCX).
Index:
    - PDF_CONTENT_TYPE / DOCX_CONTENT_TYPE: supported MIME types
    - UnsupportedDocumentError: raised for other file types or files with no text
    - DocumentTooLongError: raised when the page count or extracted text is over the import cap
    - extract_document_text: returns the text of a file given its bytes and content type
"""

from io import BytesIO
from math import ceil
from typing import Any
from urllib.parse import urlparse

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
    """Joins every PDF page's text and its external hyperlink labels and targets."""
    reader = PdfReader(BytesIO(file_bytes))
    if len(reader.pages) > MAX_PDF_PAGES:
        raise DocumentTooLongError("The file has too many pages")
    return "\n\n".join(_extract_pdf_page(page) for page in reader.pages)


def _extract_pdf_page(page: Any) -> str:
    """Returns one page's text followed by explicit markers for its URI annotations."""
    fragments: list[tuple[str, float, float, float]] = []

    def remember_text(
        text: str,
        current_matrix: list[float],
        text_matrix: list[float],
        _font: dict[str, Any] | None,
        font_size: float,
    ) -> None:
        """Records rendered text origins so annotation rectangles can recover link labels."""
        x = text_matrix[4] * current_matrix[0] + text_matrix[5] * current_matrix[2] + current_matrix[4]
        y = text_matrix[4] * current_matrix[1] + text_matrix[5] * current_matrix[3] + current_matrix[5]
        if text.strip():
            fragments.append((text.strip(), x, y, font_size))

    text = page.extract_text(visitor_text=remember_text) or ""
    markers = _pdf_hyperlink_markers(page, fragments)
    return "\n".join([text, *markers]).strip()


def _pdf_hyperlink_markers(
    page: Any, fragments: list[tuple[str, float, float, float]]
) -> list[str]:
    """Turns external PDF link annotations into label-and-URL markers for the parser."""
    markers: list[str] = []
    seen_urls: set[str] = set()
    for reference in page.get("/Annots", []):
        annotation = reference.get_object()
        action_reference = annotation.get("/A") or {}
        action = action_reference.get_object() if hasattr(action_reference, "get_object") else action_reference
        uri = str(action.get("/URI") or "").strip()
        rectangle = annotation.get("/Rect")
        if not uri or uri in seen_urls or not rectangle or len(rectangle) != 4:
            continue
        seen_urls.add(uri)
        x1, y1, x2, y2 = (float(value) for value in rectangle)
        label = _pdf_link_label(uri, (x1, y1, x2, y2), fragments)
        markers.append(_hyperlink_marker(label, uri))
    return markers


def _pdf_link_label(
    uri: str,
    rectangle: tuple[float, float, float, float],
    fragments: list[tuple[str, float, float, float]],
) -> str:
    """Finds the visible label within an annotation, avoiding the rest of its text line."""
    x1, y1, x2, y2 = rectangle
    overlapping = [
        fragment
        for fragment in fragments
        if fragment[1] <= x2 + 2
        and fragment[1] + max(len(fragment[0]), 1) * fragment[3] * 0.6 >= x1 - 2
        and fragment[2] <= y2 + fragment[3]
        and fragment[2] + fragment[3] >= y1 - 2
    ]
    branded_label = _known_link_label(uri)
    if branded_label:
        return branded_label

    pieces = [_text_inside_rectangle(fragment, x1, x2) for fragment in overlapping]
    return " ".join(piece for piece in pieces if piece).strip(" ·|,-") or uri


def _known_link_label(uri: str) -> str | None:
    """Returns a canonical label for links whose service name is unambiguous."""
    hostname = (urlparse(uri).hostname or "").lower()
    known_labels = {"linkedin.com": "LinkedIn", "github.com": "GitHub"}
    for domain, label in known_labels.items():
        if hostname == domain or hostname.endswith(f".{domain}"):
            return label
    return None

def _text_inside_rectangle(
    fragment: tuple[str, float, float, float], x1: float, x2: float
) -> str:
    """Approximates which characters of one PDF text fragment sit inside a link rectangle."""
    text, x, _y, font_size = fragment
    character_width = max(font_size * 0.6, 1)
    start = max(0, int((x1 - x) / character_width))
    end = min(len(text), ceil((x2 - x) / character_width))
    return text[start:end].strip(" ·|,-")


def _extract_docx_text(file_bytes: bytes) -> str:
    """Joins DOCX paragraphs and table cells while retaining hyperlink destinations."""
    document = Document(BytesIO(file_bytes))
    lines = [_docx_paragraph_text(paragraph) for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                lines.extend(_docx_paragraph_text(paragraph) for paragraph in cell.paragraphs)
    return "\n".join(lines)


def _docx_paragraph_text(paragraph: Any) -> str:
    """Returns paragraph text plus list and hyperlink markers needed by resume parsing."""
    style_name = paragraph.style.name.casefold()
    if style_name.startswith("list bullet"):
        text = f"• {paragraph.text}"
    elif style_name.startswith("list number"):
        text = f"1. {paragraph.text}"
    else:
        text = paragraph.text
    markers = [
        _hyperlink_marker(hyperlink.text.strip() or hyperlink.url, hyperlink.url)
        for hyperlink in paragraph.hyperlinks
        if hyperlink.url
    ]
    return "\n".join([text, *markers])


def _hyperlink_marker(label: str, url: str) -> str:
    """Formats a link so the parsing model can reliably preserve both values."""
    safe_label = label.replace('"', "'")
    safe_url = url.replace('"', "%22")
    return f'[hyperlink label="{safe_label}" url="{safe_url}"]'
