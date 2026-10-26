"""Extract resume text from PDF and DOCX uploads within the import limits.

Keep DOCX paragraphs and distinct table cells in document order, retaining list markers and
hyperlink labels and targets so the resume parser can use their context. Include active
headers before the body and footers after it, reading inherited parts only once.
Malformed link destinations remain source text without aborting extraction.
PDF annotation arrays may be indirect references or explicitly absent via null.
Explicitly removed DOCX numbering does not create a list marker.
Known PDF and DOCX container read errors become the caller's unreadable-file error.
"""

from io import BytesIO
from math import ceil
from typing import Any
from urllib.parse import urlparse
from zipfile import BadZipFile

from docx import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from pypdf import PdfReader
from pypdf.errors import PdfReadError
from pypdf.generic import NullObject

from text_limits import MAX_PDF_PAGES, MAX_RESUME_TEXT

PDF_CONTENT_TYPE = "application/pdf"
DOCX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


class UnsupportedDocumentError(Exception):
    """The file has an unsupported type, unreadable container, or no text layer."""


class DocumentTooLongError(Exception):
    """The file has too many pages or too much text to import."""


def extract_document_text(file_bytes: bytes, content_type: str) -> str:
    """Returns the file's text. Raises UnsupportedDocumentError if there is none, and
    DocumentTooLongError when the page count or the text is over the import cap."""
    try:
        if content_type == PDF_CONTENT_TYPE:
            text = _extract_pdf_text(file_bytes)
        elif content_type == DOCX_CONTENT_TYPE:
            text = _extract_docx_text(file_bytes)
        else:
            raise UnsupportedDocumentError(f"Unsupported file type: {content_type}")
    except (PdfReadError, BadZipFile):
        raise UnsupportedDocumentError("The file's document container could not be read") from None

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
    annotations = page.get("/Annots", [])
    if hasattr(annotations, "get_object"):
        annotations = annotations.get_object()
    if isinstance(annotations, NullObject):
        return markers
    for reference in annotations:
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
    try:
        hostname = (urlparse(uri).hostname or "").lower()
    except ValueError:
        return None
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
    """Keep body text and active margin stories, including their hyperlink destinations."""
    document = Document(BytesIO(file_bytes))
    return "\n".join([
        *_docx_margin_lines(document, "header"),
        *_docx_block_lines(document),
        *_docx_margin_lines(document, "footer"),
    ])


def _docx_margin_lines(document: Any, kind: str) -> list[str]:
    """Read enabled header/footer variants once, even when sections share a part."""
    lines: list[str] = []
    seen_parts = set()
    for section in document.sections:
        names = [kind]
        if section.different_first_page_header_footer:
            names.append(f"first_page_{kind}")
        if document.settings.odd_and_even_pages_header_footer:
            names.append(f"even_page_{kind}")
        for name in names:
            story = getattr(section, name)
            if story.part in seen_parts:
                continue
            seen_parts.add(story.part)
            story_lines = _docx_block_lines(story)
            if any(line.strip() for line in story_lines):
                lines.extend(story_lines)
    return lines


def _docx_block_lines(container: Any) -> list[str]:
    """Read document or cell blocks in order, descending into nested tables."""
    lines: list[str] = []
    for block in container.iter_inner_content():
        if isinstance(block, Paragraph):
            lines.append(_docx_paragraph_text(block))
        else:
            seen_cells = set()
            for row in block.rows:
                for cell in row.cells:
                    # Merged grid positions can refer to the same underlying cell.
                    if cell._tc in seen_cells:
                        continue
                    seen_cells.add(cell._tc)
                    lines.extend(_docx_block_lines(cell))
    return lines


def _docx_paragraph_text(paragraph: Any) -> str:
    """Returns paragraph text plus list and hyperlink markers needed by resume parsing."""
    style_name = paragraph.style.name.casefold()
    if _docx_paragraph_is_numbered(paragraph):
        marker = "1." if style_name.startswith("list number") else "•"
        text = f"{marker} {paragraph.text}"
    else:
        text = paragraph.text
    markers = [
        _hyperlink_marker(hyperlink.text.strip() or hyperlink.url, hyperlink.url)
        for hyperlink in paragraph.hyperlinks
        if hyperlink.url
    ]
    return "\n".join([text, *markers])


def _docx_paragraph_is_numbered(paragraph: Any) -> bool:
    """Resolve numbering overrides before styles; numId zero explicitly removes a list."""
    properties = [paragraph._p.pPr]
    style = paragraph.style
    while style is not None:
        properties.append(style._element.pPr)
        style = style.base_style
    for paragraph_properties in properties:
        if paragraph_properties is None:
            continue
        number_properties = paragraph_properties.find(qn("w:numPr"))
        if number_properties is not None and number_properties.numId is not None:
            return number_properties.numId.val != 0
    return False


def _hyperlink_marker(label: str, url: str) -> str:
    """Formats a link so the parsing model can reliably preserve both values."""
    safe_label = label.replace('"', "'")
    safe_url = url.replace('"', "%22")
    return f'[hyperlink label="{safe_label}" url="{safe_url}"]'
