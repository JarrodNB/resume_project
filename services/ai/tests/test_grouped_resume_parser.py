"""Exercise concurrent parsing and exact experience reconstruction through public interfaces."""

import asyncio

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage, UsageLimits

from agents.resume_parsing_agent import parse_resume_text


def parse(timeout=5):
    return parse_resume_text(
        "A complete masked resume\n• Built a thing", "openai:gpt-5-mini", "low", timeout, "openai:gpt-5-nano"
    )


def test_groups_overlap_and_assemble_in_fixed_order(offline_model_resolution):
    active = 0
    peak = 0
    arrived = asyncio.Event()

    async def answer(messages, info):
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        if active == 3:
            arrived.set()
        await asyncio.wait_for(arrived.wait(), 0.5)
        schema = info.output_tools[0].parameters_json_schema["properties"]
        if "experiences" in schema:
            prompt = messages[-1].parts[-1].content
            assert "Include every source bullet that belongs to each role." in prompt
            assert "[B1] • Built a thing" in prompt
            assert "Trusted source bullet map" not in prompt
            await asyncio.sleep(0.03)
            args = {
                "experiences": [
                    {"company": "Acme", "title": "Engineer", "highlight_ids": ["B1"]}
                ],
                "parsing_warnings": ["Experience warning", "Shared"],
            }
        elif "projects" in schema:
            args = {
                "projects": [{"name": "Demo"}],
                "skills": [{"name": "Python"}],
                "parsing_warnings": ["Shared"],
            }
        else:
            await asyncio.sleep(0.01)
            args = {"summary": "Summary", "parsing_warnings": ["Profile warning"],
                    "job_title_suggestions": [" Backend engineer ", "backend engineer", "", "API developer"]}
        active -= 1
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, args)],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    from llm.usage import collect_task_usage

    with collect_task_usage():
        result = parse()
    assert peak == 3
    assert result.parsed_resume.experiences[0].highlights == ["Built a thing"]
    assert result.parsed_resume.skills[0].name == "Python"
    assert result.parsed_resume.summary == "Summary"
    assert result.job_title_suggestions == ["Backend engineer", "API developer"]
    assert "job_title_suggestions" not in result.parsed_resume.model_dump()
    assert result.usage.requests == 3
    assert result.parsed_resume.parsing_warnings == [
        "Experience warning",
        "Shared",
        "Profile warning",
    ]
    assert result.usage.input_tokens == 30


def test_combined_requests_reserve_inflight_capacity(monkeypatch, offline_model_resolution):
    calls = 0
    cancelled = 0

    async def answer(messages, info):
        nonlocal calls, cancelled
        calls += 1
        try:
            await asyncio.sleep(10)
        finally:
            cancelled += 1

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda settings: UsageLimits(request_limit=2),
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    from llm.usage import collect_task_usage

    with collect_task_usage(), pytest.raises(UsageLimitExceeded):
        parse()
    assert calls == 2
    assert cancelled == 2


def test_whole_deadline_cancels_and_awaits_every_group(offline_model_resolution):
    cancelled = []

    async def answer(messages, info):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    from llm.usage import collect_task_usage

    with collect_task_usage(), pytest.raises(TimeoutError):
        parse(0.8)
    assert len(cancelled) == 3


def test_success_preserves_each_groups_answering_model(offline_model_resolution):
    from pydantic_ai.exceptions import ModelHTTPError

    async def answer(messages, info):
        properties = info.output_tools[0].parameters_json_schema["properties"]
        if "projects" in properties:
            raise ModelHTTPError(503, "synthetic", "unavailable")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    async def fallback(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=2),
        )

    offline_model_resolution(
        "openai:gpt-5-mini", FunctionModel(answer, model_name="openai:gpt-5-mini")
    )
    offline_model_resolution(
        "openai:gpt-5-nano", FunctionModel(fallback, model_name="openai:gpt-5-nano")
    )
    from llm.usage import collect_task_usage

    with collect_task_usage():
        result = parse()
    assert [entry.model for entry in result.model_usages] == [
        "openai:gpt-5-mini",
        "openai:gpt-5-nano",
        "openai:gpt-5-mini",
    ]
    assert result.usage.input_tokens == 30


def test_source_screened_once_and_group_prompts_reuse_exact_approval(monkeypatch):
    from pydantic_ai.models.test import TestModel

    from screening import prompt_guardrail

    calls = []
    classify = prompt_guardrail._screen_prompt_text

    async def screen(text, model, timeout):
        calls.append(text)
        return await classify(text, model, timeout)

    monkeypatch.setattr(prompt_guardrail, "_screen_prompt_text", screen)
    monkeypatch.setattr("agents.resume_parsing_agent.generative_model", lambda *_args: TestModel())
    parse()
    assert calls == ["A complete masked resume\n• Built a thing"]


def test_source_bullets_keep_wrapped_duplicate_passages_and_masked_tokens():

    source = "Acme\n• Built a PERSON_TOKEN\n  across two lines\n• Built a PERSON_TOKEN\n"
    assert _reconstructed_source_bullets(source) == {
        "B1": "Built a PERSON_TOKEN\nacross two lines",
        "B2": "Built a PERSON_TOKEN",
    }


def test_pdf_extracted_bullets_are_restored_from_source_ids(offline_model_resolution):
    from io import BytesIO

    from pypdf import PdfWriter
    from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

    from documents.extract_document_text import PDF_CONTENT_TYPE, extract_document_text

    writer = PdfWriter()
    page = writer.add_blank_page(width=612, height=792)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
            NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
        }
    )
    content = DecodedStreamObject()
    content.set_data(
        b"BT /F1 12 Tf 14 TL 50 700 Td "
        b"(WORK EXPERIENCE) Tj T* (Acme) Tj T* (Engineer) Tj T* "
        b"(2022 - Present) Tj T* (\x95 Built a reliable API.) Tj ET"
    )
    page[NameObject("/Contents")] = writer._add_object(content)
    pdf_bytes = BytesIO()
    writer.write(pdf_bytes)
    source = extract_document_text(pdf_bytes.getvalue(), PDF_CONTENT_TYPE)
    assert "• Built a reliable API." in source

    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {
                "experiences": [
                    {"company": "Acme", "title": "Engineer", "highlight_ids": ["B1"]}
                ]
            }
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(
        source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini"
    )

    assert result.parsed_resume.experiences[0].highlights == ["Built a reliable API."]


def test_source_bullets_keep_unindented_wraps_and_stop_before_role_and_section_headers():

    source = (
        "Senior Engineer — Acme\n2022 – Present\n"
        "• Improved our\nRetention by 20% across teams.\n"
        "Engineer — Acme\n2019 – 2022\n"
        "• Built a reliable deployment platform.\nEDUCATION\n"
    )
    assert _reconstructed_source_bullets(source) == {
        "B1": "Improved our\nRetention by 20% across teams.",
        "B2": "Built a reliable deployment platform.",
    }


def test_source_bullets_keep_unindented_sentence_continuations():

    source = (
        "Product Manager — Acme\n2022 – Present\n"
        "• Launched the new onboarding flow in five regions.\n"
        "This improved retention and cut support requests.\n"
    )
    assert _reconstructed_source_bullets(source) == {
        "B1": "Launched the new onboarding flow in five regions.\n"
        "This improved retention and cut support requests."
    }


def test_source_bullets_keep_bullet_text_ending_in_a_date_range():

    source = "Managed the program from 2019–2024\n• Led the rollout across five regions, 2020–2024\n"
    assert _reconstructed_source_bullets(source) == {"B1": "Led the rollout across five regions, 2020–2024"}


def test_source_bullets_exclude_project_and_skill_section_bullets():

    source = (
        "WORK EXPERIENCE\nAcme\nEngineer\n2022 – Present\n• Built a reliable API.\n"
        "PROJECTS\n• Built a personal portfolio.\n"
        "SKILLS\n• Python\n"
    )
    assert _reconstructed_source_bullets(source) == {"B1": "Built a reliable API."}


@pytest.mark.parametrize("heading", ["SIDE PROJECTS", "SELECTED PROJECTS", "ACADEMIC PROJECTS"])
def test_source_bullets_stop_at_project_heading_variants(heading):

    source = (
        "WORK EXPERIENCE\nAcme\nEngineer\n2022 – Present\n• Built a reliable API.\n"
        f"{heading}\n• Built a personal portfolio.\n"
    )
    assert _reconstructed_source_bullets(source) == {"B1": "Built a reliable API."}


def test_source_bullets_exclude_technical_skills_section_bullets():

    source = (
        "WORK EXPERIENCE\nAcme\nEngineer\n2022 – Present\n• Built a reliable API.\n"
        "TECHNICAL SKILLS\n• Python\n"
    )
    assert _reconstructed_source_bullets(source) == {"B1": "Built a reliable API."}


def test_source_bullets_exclude_professional_summary_bullets_before_experience():

    source = (
        "PROFESSIONAL SUMMARY\n• Product leader with ten years of experience.\n"
        "WORK EXPERIENCE\nAcme\nEngineer\n2022 – Present\n• Built a reliable API.\n"
    )
    assert _reconstructed_source_bullets(source) == {"B1": "Built a reliable API."}


def test_parser_ignores_unheaded_preamble_bullets_before_dated_work_history(
    offline_model_resolution,
):
    source = (
        "Former teacher transitioning into software development.\n"
        "• Organized classroom activities for 150 students.\n"
        "Senior Engineer, Acme — 2022–Present\n"
        "• Built a reliable API.\n"
    )

    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {
                "experiences": [
                    {"company": "Acme", "title": "Senior Engineer", "highlight_ids": ["B1"]}
                ]
            }
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(
        source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini"
    )

    assert result.parsed_resume.experiences[0].highlights == ["Built a reliable API."]


def test_nonexperience_group_instructions_only_name_owned_fields():
    from prompts.resume_parsing_instructions import format_resume_group_instruction

    for group in ("ProjectsSkillsExtraction", "ProfileExtraction"):
        instruction = format_resume_group_instruction(group).casefold()
        assert "experiences" not in instruction
        assert "bullets" not in instruction

    assert "projects, skills" in format_resume_group_instruction("ProjectsSkillsExtraction")
    assert "contact, summary, educations, certifications" in format_resume_group_instruction(
        "ProfileExtraction"
    )

    experience_instruction = format_resume_group_instruction("ExperienceExtraction").casefold()
    assert "copy each stated company, title, and date from that role's own header" in (
        experience_instruction
    )
    assert "do not leave stated role fields blank" in experience_instruction
    assert "one deliverable for an unnamed client" in experience_instruction


def test_source_bullets_stop_before_role_headers_with_inline_dates():

    source = (
        "WORK EXPERIENCE\n"
        "• Built a complex payment system used across three regions.\n"
        "Senior Engineer, Acme — 2022–Present\n"
        "• Improved reliability by 30%.\n"
    )
    assert _reconstructed_source_bullets(source) == {
        "B1": "Built a complex payment system used across three regions.",
        "B2": "Improved reliability by 30%.",
    }


def test_source_bullets_stop_before_role_headers_without_dates():

    source = (
        "WORK EXPERIENCE\n"
        "• Built a complex platform used across three regions.\n"
        "Senior Engineer, Acme\n"
        "• Improved reliability by 30%.\n"
    )
    assert _reconstructed_source_bullets(source) == {
        "B1": "Built a complex platform used across three regions.",
        "B2": "Improved reliability by 30%.",
    }


def test_source_bullets_stop_before_split_role_headers():

    source = (
        "WORK EXPERIENCE\n"
        "• Built a complex platform used across three regions.\n"
        "Senior Engineer\n"
        "Acme\n"
        "2022 - Present\n"
        "• Improved reliability by 30%.\n"
    )
    assert _reconstructed_source_bullets(source) == {
        "B1": "Built a complex platform used across three regions.",
        "B2": "Improved reliability by 30%.",
    }


def test_experience_output_empty_highlights_and_multiple_roles_can_be_rebuilt(offline_model_resolution):
    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {"experiences": [
                {"company": "Acme", "title": "Engineer", "highlight_ids": ["B2", "B1"]},
                {"company": "Acme", "title": "Lead", "highlight_ids": []},
            ]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(
        "Acme\nEngineer\n• Built the first thing.\n• Built the second thing.\n\nLead",
        "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini",
    )
    assert [r.highlights for r in result.parsed_resume.experiences] == [
        ["Built the first thing.", "Built the second thing."],
        [],
    ]
    assert result.parsed_resume.model_dump()["experiences"][0]["highlights"] == [
        "Built the first thing.",
        "Built the second thing.",
    ]


@pytest.mark.parametrize("ids", [["B404"], ["B1", "B1"]])
def test_invalid_or_duplicate_source_ids_fail_without_partial_resume(ids, offline_model_resolution):
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {"experiences": [{"company": "Acme", "title": "Engineer", "highlight_ids": ids}]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    with pytest.raises(UnexpectedModelBehavior):
        parse_resume_text(
            "Acme\n• Built a thing", "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini"
        )


def test_invalid_source_id_is_retried_before_rebuilding_highlights(offline_model_resolution):
    experience_calls = 0

    async def answer(messages, info):
        nonlocal experience_calls
        properties = info.output_tools[0].parameters_json_schema["properties"]
        if "experiences" in properties:
            experience_calls += 1
            ids = ["B404"] if experience_calls == 1 else ["B1"]
            args = {"experiences": [{"company": "Acme", "title": "Engineer", "highlight_ids": ids}]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(
        "Acme\nEngineer\n2022–Present\n• Built a thing",
        "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini",
    )
    assert experience_calls == 2
    assert result.parsed_resume.experiences[0].highlights == ["Built a thing"]


def test_combined_tokens_fail_even_when_each_response_fits(monkeypatch, offline_model_resolution):
    async def answer(messages, info):
        await asyncio.sleep(0.01)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=10, output_tokens=4),
        )

    monkeypatch.setattr(
        "agents.resume_parsing_agent.agent_usage_limits",
        lambda settings: UsageLimits(output_tokens_limit=10),
    )
    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    from llm.usage import collect_task_usage

    with collect_task_usage(), pytest.raises(UsageLimitExceeded):
        parse()


def test_fallback_charges_survive_later_group_failure(offline_model_resolution):
    from pydantic_ai.exceptions import ModelHTTPError

    from llm.usage import collect_task_usage

    async def primary(messages, info):
        raise ModelHTTPError(503, "synthetic", "unavailable")

    async def fallback(messages, info):
        properties = info.output_tools[0].parameters_json_schema["properties"]
        if "contact" in properties:
            await asyncio.sleep(0.03)
            raise ValueError("synthetic group failure")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})],
            usage=RequestUsage(input_tokens=11, output_tokens=3),
        )

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(primary))
    offline_model_resolution(
        "openai:gpt-5-nano", FunctionModel(fallback, model_name="openai:gpt-5-nano")
    )
    with (
        collect_task_usage() as charges,
        pytest.raises(ValueError, match="synthetic group failure"),
    ):
        parse()
    assert charges.incomplete
    assert len(charges.entries) == 2
    assert all(entry.model == "openai:gpt-5-nano" for entry in charges.entries)
    assert sum(entry.input_tokens for entry in charges.entries) == 22


def test_group_failure_cancels_and_awaits_siblings(offline_model_resolution):
    started = 0
    cancelled = []
    ready = asyncio.Event()

    async def answer(messages, info):
        nonlocal started
        started += 1
        if started == 3:
            ready.set()
        await ready.wait()
        if "projects" in info.output_tools[0].parameters_json_schema["properties"]:
            raise ValueError("group failed")
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    offline_model_resolution("openai:gpt-5-nano", FunctionModel(answer))
    from llm.usage import collect_task_usage

    with collect_task_usage(), pytest.raises(ValueError, match="group failed"):
        parse()
    assert len(cancelled) == 2


def test_split_roles_restore_wrapped_duplicate_passages_in_source_order(offline_model_resolution):
    source = (
        "WORK EXPERIENCE\nSenior Engineer\nAcme\n2022 - Present\n"
        "• Built a PERSON_TOKEN platform\n  across two regions.\n"
        "• Reduced support requests by 30%.\n"
        "Software Engineer\nContoso\n2019 - 2022\n"
        "• Built a PERSON_TOKEN platform\n  across two regions.\n"
        "• Improved deployment reliability.\n"
        "PROJECTS\n• Built a personal site.\n"
    )

    async def answer(messages, info):
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            args = {"experiences": [
                {"company": "Acme", "title": "Senior Engineer", "start_date": "2022",
                 "is_current": True, "highlight_ids": ["B2", "B1"]},
                {"company": "Contoso", "title": "Software Engineer", "start_date": "2019",
                 "end_date": "2022", "highlight_ids": ["B4", "B3"]},
            ]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse_resume_text(source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
    roles = result.parsed_resume.experiences
    assert [(role.company, role.title, role.start_date, role.end_date) for role in roles] == [
        ("Acme", "Senior Engineer", "2022", None),
        ("Contoso", "Software Engineer", "2019", "2022"),
    ]
    assert roles[0].is_current
    assert [role.highlights for role in roles] == [
        ["Built a PERSON_TOKEN platform\nacross two regions.", "Reduced support requests by 30%."],
        ["Built a PERSON_TOKEN platform\nacross two regions.", "Improved deployment reliability."],
    ]


@pytest.mark.parametrize("recover", [False, True])
def test_source_id_reused_across_roles_retries_or_fails(recover, offline_model_resolution):
    from pydantic_ai.exceptions import UnexpectedModelBehavior

    calls = 0

    async def answer(messages, info):
        nonlocal calls
        if "experiences" in info.output_tools[0].parameters_json_schema["properties"]:
            calls += 1
            args = {"experiences": [
                {"company": "Acme", "title": "Engineer", "highlight_ids": ["B1"]},
                {"company": "Contoso", "title": "Engineer",
                 "highlight_ids": ["B2"] if recover and calls > 1 else ["B1"]},
            ]}
        else:
            args = {}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, args)])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    source = "WORK EXPERIENCE\n• Built one thing.\n• Built another thing."
    if recover:
        result = parse_resume_text(source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
        assert calls == 2
        assert [role.highlights for role in result.parsed_resume.experiences] == [
            ["Built one thing."], ["Built another thing."],
        ]
    else:
        with pytest.raises(UnexpectedModelBehavior):
            parse_resume_text(source, "openai:gpt-5-mini", "low", 5, "openai:gpt-5-mini")
        assert calls == 3


def _reconstructed_source_bullets(source):
    """Read all labeled passages back through validated selection and reconstruction."""
    import re

    from documents.experience_source import ExperienceSource

    experience_source = ExperienceSource(source)
    ids = re.findall(r"\[(B\d+)\]", experience_source.annotated_text)
    output = experience_source.output_type.model_validate({
        "experiences": [{"company": "Example", "title": "Engineer", "highlight_ids": ids}],
    })
    highlights = experience_source.reconstruct(output)["experiences"][0]["highlights"]
    return dict(zip(ids, highlights, strict=True))


@pytest.mark.parametrize("selections", [[['B404']], [['B1', 'B1']], [['B1'], ['B1']]])
def test_experience_source_reconstruction_rejects_unvalidated_invalid_selections(selections):
    from documents.experience_source import ExperienceSource
    from schemas.parsed_resume import ExperienceExtraction

    source = ExperienceSource("WORK EXPERIENCE\n• Built a reliable platform.")
    output = ExperienceExtraction(experiences=[
        {"company": "Example", "title": "Engineer", "highlight_ids": ids}
        for ids in selections
    ])

    with pytest.raises(ValueError, match="Use only known source bullet IDs, once per resume"):
        source.reconstruct(output)


@pytest.mark.parametrize("suggestions", [None, "wrong", [42], ["", "x" * 101]])
def test_unusable_optional_titles_do_not_fail_extraction(suggestions, offline_model_resolution):
    def answer(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "job_title_suggestions": suggestions, "summary": "Original summary",
        })])

    offline_model_resolution("openai:gpt-5-mini", FunctionModel(answer))
    result = parse()
    assert result.parsed_resume.summary == "Original summary"
    assert result.job_title_suggestions == []
    assert result.usage.requests == 3
