"""Keep synthetic resume bullets intact while respecting employment and section boundaries.

These tests use the public source selector and real file extractors. Model responses are
synthetic selections; they test reconstruction rather than model interpretation quality.
"""

import re

import pytest

from documents.experience_source import ExperienceSource


def source_highlights(text):
    source = ExperienceSource(text)
    ids = re.findall(r"\[(B\d+)\]", source.annotated_text)
    output = source.output_type.model_validate({
        "experiences": [{"company": "Example", "title": "Engineer", "highlight_ids": ids}],
    })
    return source.reconstruct(output)["experiences"][0]["highlights"]


def test_stacked_role_header_with_dates_does_not_enter_previous_bullet():
    text = (
        "WORK EXPERIENCE\nExample | Remote\nEngineer | January 2025 – September 2026\n"
        "• Built a payment system used across three regions.\n"
        "Software Developer | 2019 – 2024\n"
        "• Reduced deployment failures.\n"
    )
    assert source_highlights(text) == [
        "Built a payment system used across three regions.", "Reduced deployment failures.",
    ]


def test_acronym_and_blank_line_continuations_stay_in_one_bullet():
    text = (
        "WORK EXPERIENCE\nEngineer | 2020 – Present\n"
        "• Integrated the platform with\nAWS SQS\n\n"
        "to deliver reliable notifications.\n"
        "• Built the reporting service.\nSKILLS\n• Python\n"
    )
    assert source_highlights(text) == [
        "Integrated the platform with\nAWS SQS\nto deliver reliable notifications.",
        "Built the reporting service.",
    ]


def test_blank_separators_do_not_hide_real_boundaries():
    text = (
        "WORK EXPERIENCE\n• Built the first service.\n\n"
        "Software Engineer\n\nExample\n\n2020 – Present\n"
        "• Built the next service.\n\nEDUCATION\n• Studied computing.\n"
    )
    assert source_highlights(text) == ["Built the first service.", "Built the next service."]


def build_pdf(pages):
    from io import BytesIO

    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    writer = PdfWriter()
    font = DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
    })
    for lines in pages:
        page = writer.add_blank_page(width=612, height=792)
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        })
        stream = DecodedStreamObject()
        encoded = []
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            encoded.append(b"(" + escaped.encode("cp1252") + b") Tj T*")
        stream.set_data(b"BT /F1 12 Tf 14 TL 50 700 Td " + b" ".join(encoded) + b" ET")
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def build_docx(pages):
    from io import BytesIO

    from docx import Document

    document = Document()
    for index, lines in enumerate(pages):
        if index:
            document.add_page_break()
        for line in lines:
            if line.startswith("• "):
                document.add_paragraph(line[2:], style="List Bullet")
            else:
                document.add_paragraph(line)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


@pytest.mark.parametrize("file_format", ["pdf", "docx"])
def test_uploaded_files_preserve_stacked_bullets_through_final_parser(
    file_format, offline_model_resolution,
):
    from pydantic_ai.messages import ModelResponse, ToolCallPart
    from pydantic_ai.models.function import FunctionModel

    from agents.resume_parsing_agent import parse_resume_text
    from documents.extract_document_text import (
        DOCX_CONTENT_TYPE,
        PDF_CONTENT_TYPE,
        extract_document_text,
    )

    pages = [
        [
            "WORK EXPERIENCE", "Earlier Company", "Engineer | 2017 – 2018",
            "• Built a payment system used across three regions.",
            "Example | Remote", "AI Integrations Engineer | 2025 – 2026",
            "Software Developer | 2019 – 2024",
            "• Integrated the platform with", "AWS SQS",
        ],
        [
            "to deliver reliable notifications.", "",
            "• Built the reporting service.", "EDUCATION", "• Studied computing.",
        ],
    ]
    if file_format == "pdf":
        file_bytes, content_type = build_pdf(pages), PDF_CONTENT_TYPE
    else:
        file_bytes, content_type = build_docx(pages), DOCX_CONTENT_TYPE
    source = extract_document_text(file_bytes, content_type)
    expected = [
        "Built a payment system used across three regions.",
        "Integrated the platform with\nAWS SQS\nto deliver reliable notifications.",
        "Built the reporting service.",
    ]
    assert source_highlights(source) == expected

    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {"experiences": [
                {"company": "Earlier Company", "title": "Engineer", "highlight_ids": ["B1"]},
                {"company": "Example", "title": "Software Developer",
                 "highlight_ids": ["B3", "B2"]},
            ]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    assert [role.highlights for role in result.parsed_resume.experiences] == [
        expected[:1], expected[1:],
    ]


def test_short_complete_sentence_keeps_its_following_paragraph():
    text = (
        "WORK EXPERIENCE\nEngineer | 2020 – Present\n"
        "• Built APIs.\n\nThis reduced outages.\n"
        "SKILLS\n• Python\n"
    )
    assert source_highlights(text) == ["Built APIs.\nThis reduced outages."]


def test_separate_uppercase_section_after_completed_bullet_stays_outside_highlight():
    text = (
        "WORK EXPERIENCE\nEngineer | 2020 – Present\n"
        "• Built a reliable payment service.\n\n"
        "PROFESSIONAL DEVELOPMENT\nCompleted training in distributed systems.\n"
    )
    assert source_highlights(text) == ["Built a reliable payment service."]
