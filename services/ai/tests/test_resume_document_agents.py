"""Exercise real writer/reviewer boundaries with offline models, privacy and request caps."""

import asyncio

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RunUsage

from agents.resume_document_agent import resume_document_agent, write_resume_document
from agents.resume_editorial_agent import resume_editorial_agent, review_resume_document
from worker.contact_mask import contact_scope, install_contact_hooks
from worker.known_contact import KnownContact


@pytest.mark.parametrize("kind", ["writer", "reviewer"])
def test_separate_agents_mask_contacts_and_report_real_usage(kind, task_dependencies):
    seen = []

    def answer(messages, info):
        text = str(messages)
        seen.append(text)
        if kind == "writer":
            output = {
                "markdown": "# «name»\n\nUseful work.",
                "sufficient_for_target": True,
                "sufficiency_explanation": "Relevant work fits one page.",
            }
        else:
            output = {
                "ready": True,
                "feedback": "Clear account of «name» experience.",
                "sufficient_for_target": True,
                "sufficiency_explanation": "One page is appropriate.",
            }
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, output)],
            model_name="openai:gpt-5-mini",
            usage=RunUsage(input_tokens=13, output_tokens=7),
        )

    agent, run = (
        (resume_document_agent, write_resume_document)
        if kind == "writer"
        else (resume_editorial_agent, review_resume_document)
    )
    install_contact_hooks()
    with (
        contact_scope(
            KnownContact.from_values(names=["Synthetic Person"], emails=["private@example.test"])
        ),
        agent.override(model=FunctionModel(answer, model_name="openai:gpt-5-mini")),
    ):
        result = asyncio.run(
            run("Synthetic Person private@example.test", task_dependencies.settings)
        )
    assert seen and all(
        "Synthetic Person" not in prompt and "private@example.test" not in prompt for prompt in seen
    )
    assert "Synthetic Person" in result.output.model_dump_json()
    assert result.usage.input_tokens == 13 and result.usage.output_tokens == 7
    assert result.model == "openai:gpt-5-mini"


@pytest.mark.parametrize(
    "agent,run",
    [
        (resume_document_agent, write_resume_document),
        (resume_editorial_agent, review_resume_document),
    ],
)
def test_request_budget_prevents_provider_execution(agent, run, task_dependencies):
    seen = []

    def answer(messages, info):
        seen.append(True)
        raise AssertionError("must not call provider")

    settings = task_dependencies.settings.model_copy(update={"llm_request_limit": 0})
    with (
        agent.override(model=FunctionModel(answer, model_name="openai:gpt-5-mini")),
        pytest.raises(UsageLimitExceeded),
    ):
        asyncio.run(run("safe source", settings))
    assert not seen
