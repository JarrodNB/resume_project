"""
Description: Test doubles and builders shared by the pytest suite.
Index:
    - FakeFileStorage: serves file bytes from a dict instead of S3
    - build_docx_bytes: builds a small DOCX file in memory
    - FakeJobSite: answers HTTP requests from a dict of URL -> HTML (404 for anything else)
"""

from io import BytesIO

import httpx
from docx import Document


class FakeFileStorage:
    """Stands in for S3FileStorage."""

    def __init__(self) -> None:
        """Starts empty; tests add files with `files[key] = bytes`."""
        self.files: dict[str, bytes] = {}

    def download_file(self, key: str) -> bytes:
        """Returns the stored bytes, raising KeyError for unknown keys like S3 would."""
        return self.files[key]


def build_docx_bytes(paragraphs: list[str], table_rows: list[list[str]] | None = None) -> bytes:
    """Builds a DOCX file with the given paragraphs and an optional table."""
    document = Document()
    for paragraph in paragraphs:
        document.add_paragraph(paragraph)
    if table_rows:
        table = document.add_table(rows=len(table_rows), cols=len(table_rows[0]))
        for row, values in zip(table.rows, table_rows, strict=True):
            for cell, value in zip(row.cells, values, strict=True):
                cell.text = value
    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


class FakeJobSite:
    """Stands in for job sites, through httpx.MockTransport."""

    def __init__(self) -> None:
        """Starts empty; tests add pages with `pages[url] = html` or `statuses[url] = code`."""
        self.pages: dict[str, str] = {}
        self.statuses: dict[str, int] = {}
        self.requested_urls: list[str] = []

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        """Returns the configured HTML or status for the URL, else 404."""
        url = str(request.url)
        self.requested_urls.append(url)
        if url in self.statuses:
            return httpx.Response(self.statuses[url])
        if url in self.pages:
            return httpx.Response(200, html=self.pages[url])
        return httpx.Response(404)

    def build_client(self) -> httpx.Client:
        """An httpx client whose requests this fake answers."""
        return httpx.Client(transport=httpx.MockTransport(self.handle_request))
