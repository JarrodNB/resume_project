"""Keep original import limits when privacy tokens expand an approved prompt.

Unknown history and ordinary trusted prompts retain the shared generative cap.
"""

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, UserPromptPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai_harness import InputBlocked, InputGuardrail

from screening.prompt_guardrail import TOO_LONG_MESSAGE, screen_prompt
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, screening_session
from tests.fakes import build_docx_bytes
from tests.test_task_handlers import FILE_KEY, build_parse_resume_task
from text_limits import MAX_PROMPT_TEXT, MAX_RESUME_TEXT
from worker.contact_mask import import_privacy_scope, install_contact_hooks
from worker.parse_resume_handler import handle_parse_resume_task

pytestmark = pytest.mark.real_guardrail


@pytest.fixture
def providers(monkeypatch, offline_model_resolution, task_dependencies):
    """Capture actual classifier/parser calls beneath production model adapters."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test")
    task_dependencies.settings.generative_fallback_model = task_dependencies.settings.resume_parsing_model
    install_contact_hooks()
    seen = {"screen": [], "parse": []}

    def classify(messages, info):
        seen["screen"].append(str(messages))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {"prompt_injection": False, "harmful_request": False})],
            provider_details={"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}})

    def parse(messages, info):
        seen["parse"].append(messages[-1].parts[-1].content)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {})])

    offline_model_resolution(task_dependencies.settings.user_text_screen_model, FunctionModel(classify))
    offline_model_resolution(task_dependencies.settings.resume_parsing_model, FunctionModel(parse))
    return seen


def test_valid_import_expansion_reaches_parser_once(task_dependencies, fake_file_storage, providers):
    source = "jane@example.test\n" * 3500
    assert len(source) < MAX_RESUME_TEXT
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(source.splitlines())
    result = handle_parse_resume_task(build_parse_resume_task(), task_dependencies)
    assert result.status == "completed"
    assert len(providers["parse"]) == 1
    assert len(providers["parse"][0]) > MAX_PROMPT_TEXT
    assert providers["screen"]
    assert "jane@example.test" not in repr(providers)


@pytest.mark.parametrize("prepared_import", [False, True])
def test_unknown_oversized_prompt_stays_blocked(prepared_import):
    called = []

    def answer(messages, info):
        called.append(messages)
        return ModelResponse(parts=[TextPart("unexpected")])

    agent = Agent(FunctionModel(answer), capabilities=[InputGuardrail(guard=screen_prompt)])
    with import_privacy_scope() as privacy, screening_session():
        if prepared_import:
            privacy.prepare("jane@example.test")
        with pytest.raises(InputBlocked, match=TOO_LONG_MESSAGE):
            agent.run_sync("x" * (MAX_PROMPT_TEXT + 1))
    assert not called


def test_other_task_covered_oversized_prompt_stays_blocked(task_dependencies, providers):
    called = []

    def answer(messages, info):
        called.append(messages)
        return ModelResponse(parts=[TextPart("unexpected")])

    agent = Agent(FunctionModel(answer), capabilities=[InputGuardrail(guard=screen_prompt)])
    source = "x" * (MAX_PROMPT_TEXT + 1)
    with screening_session():
        assert screen_user_text(source, task_dependencies.settings.user_text_screen_model,
                                240, max_characters=len(source)).allowed
        prompt = bind_screened_prompt([source], lambda sources: sources[0])
        with pytest.raises(InputBlocked, match=TOO_LONG_MESSAGE):
            agent.run_sync(prompt)
    assert not called


def test_unknown_history_does_not_discount_import_tokens(task_dependencies, providers):
    called = []

    def answer(messages, info):
        called.append(messages)
        return ModelResponse(parts=[TextPart("unexpected")])

    agent = Agent(FunctionModel(answer), capabilities=[InputGuardrail(guard=screen_prompt)])
    with import_privacy_scope() as privacy, screening_session():
        masked = privacy.prepare("jane@example.test")
        assert screen_user_text(masked, task_dependencies.settings.user_text_screen_model, 240).allowed
        prompt = bind_screened_prompt([masked], lambda sources: f"<resume>{sources[0]}</resume>")
        history = masked * (MAX_PROMPT_TEXT // len(masked) + 1)
        assert len(history) > MAX_PROMPT_TEXT
        assert privacy.original_length(history) < MAX_PROMPT_TEXT
        with pytest.raises(InputBlocked, match=TOO_LONG_MESSAGE):
            agent.run_sync(prompt, message_history=[
                ModelRequest(parts=[UserPromptPart(history)]),
                ModelResponse(parts=[TextPart("prior answer")]),
            ])
    assert not called
