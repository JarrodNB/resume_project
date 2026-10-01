"""
Description: Test doubles and builders shared by the pytest suite.
Index:
    - FakeFileStorage: serves file bytes from a dict instead of S3
    - build_docx_bytes: builds a small DOCX file in memory
"""

from io import BytesIO

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
