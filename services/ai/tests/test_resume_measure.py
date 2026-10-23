"""Check that the worker measures actual PDFs from the shared resume renderer."""
import subprocess
from io import BytesIO

import pytest
from pypdf import PdfReader

from documents.resume_measure import ResumeRenderError, render_and_measure_resume


def test_one_and_two_page_measurements_match_rendered_pdf():
    for count in (3, 90):
        markdown = "# Ada Lovelace\n\n## Experience\n" + "\n".join(
            f"- Delivered measurable result {index}" for index in range(count)
        )
        result = render_and_measure_resume(markdown)
        pdf = PdfReader(BytesIO(result.pdf_bytes))
        assert result.page_count == len(pdf.pages)
        assert result.page_count == (1 if count == 3 else 2)
        assert 0 < result.final_page_occupied_share <= 1
        assert "Delivered measurable result" in pdf.pages[-1].extract_text()


def test_input_is_bounded_before_rendering():
    with pytest.raises(ResumeRenderError, match="too long"):
        render_and_measure_resume("x" * 100_001)


def test_renderer_timeout_fails_without_a_measurement(monkeypatch):
    def time_out(*_args, **_kwargs):
        raise subprocess.TimeoutExpired("node", 20)

    monkeypatch.setattr("documents.resume_measure.subprocess.run", time_out)
    with pytest.raises(ResumeRenderError, match="timed out"):
        render_and_measure_resume("# Ada Lovelace")
