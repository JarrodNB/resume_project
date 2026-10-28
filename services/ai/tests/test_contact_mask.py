"""
Description: Known name, contact email, and phone become placeholders on the way out of the
app and come back on the model response.
Index:
    - test_replaces_known_contact_and_leaves_other_words
    - test_longer_known_value_wins
    - test_model_request_is_masked_and_the_response_is_restored
    - test_telemetry_payload_is_masked
    - test_search_query_uses_the_same_placeholders
"""

import asyncio

from pydantic_ai import Agent
from pydantic_ai.embeddings import TestEmbeddingModel
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from memory.embed_search_query import embed_search_query
from privacy.contact_mask import (
    _map_strings,
    contact_scope,
    current_known_contact,
    install_contact_hook,
    mask_outbound,
)
from privacy.known_contact import KnownContact


def _contact() -> KnownContact:
    """Jane Doe, one email, one phone."""
    return KnownContact.from_values(
        names=["Jane Doe"],
        emails=["Ada@Example.com"],
        phones=["555-0100"],
    )


def test_replaces_known_contact_and_leaves_other_words() -> None:
    """The full name, email, and phone are replaced. A shorter word and the city stay."""
    contact = _contact()
    masked = contact.mask("Jane Doe (jane) Ada@example.com 555-0100 in Paris. Anniversary")

    assert masked == "«name» (jane) «email» «phone» in Paris. Anniversary"
    assert contact.unmask(masked) == "Jane Doe (jane) Ada@Example.com 555-0100 in Paris. Anniversary"
    assert mask_outbound("Jane Doe") == "Jane Doe"


def test_longer_known_value_wins() -> None:
    """Jane Doe is replaced before Jane, so the shorter name does not eat the longer one."""
    contact = KnownContact.from_values(names=["Jane", "Jane Doe"])

    assert contact.mask("Jane Doe met Jane") == "«name-2» met «name-1»"
    assert contact.unmask("«name-2» met «name-1»") == "Jane Doe met Jane"
    assert KnownContact.from_values(phones=["123"]).mask("123") == "123"


def test_model_request_is_masked_and_the_response_is_restored() -> None:
    """The model sees placeholders. The caller gets the real contact back."""
    seen: list[str] = []

    def answer(messages: list[object], _info: object) -> ModelResponse:
        """Records the prompt and answers with the placeholders."""
        prompt = messages[-1].parts[-1].content  # type: ignore[attr-defined]
        seen.append(prompt)
        return ModelResponse(parts=[TextPart(content="Hello «name» at «email»")])

    agent = Agent(output_type=str, defer_model_check=True)
    install_contact_hook(agent)

    with contact_scope(_contact()):
        result = asyncio.run(
            agent.run("Write for Jane Doe <Ada@example.com>", model=FunctionModel(answer))
        )

    assert seen == ["Write for «name» <«email»>"]
    assert result.output == "Hello Jane Doe at Ada@Example.com"


def test_telemetry_payload_is_masked() -> None:
    """Trace input keeps location and links, and hides the known contact."""
    payload = {
        "contact": {
            "full_name": "Jane Doe",
            "email": "ada@example.com",
            "phone": "555-0100",
            "location": "Paris",
        }
    }

    assert _map_strings(payload, current_known_contact().mask) == payload
    with contact_scope(_contact()):
        masked = _map_strings(payload, current_known_contact().mask)

    assert masked["contact"]["full_name"] == "«name»"
    assert masked["contact"]["email"] == "«email»"
    assert masked["contact"]["phone"] == "«phone»"
    assert masked["contact"]["location"] == "Paris"


def test_search_query_uses_the_same_placeholders() -> None:
    """A query is embedded with the same placeholders as a library row."""

    class RecordingModel(TestEmbeddingModel):
        """Remembers the texts it was asked to embed."""

        def __init__(self) -> None:
            super().__init__(dimensions=4)
            self.seen: list[str] = []

        async def embed(self, inputs: str | list[str], *, input_type: str, settings: object = None):  # type: ignore[override]
            """Records inputs, then returns the deterministic test vector."""
            self.seen.extend([inputs] if isinstance(inputs, str) else list(inputs))
            return await super().embed(inputs, input_type=input_type, settings=settings)

    model = RecordingModel()
    with contact_scope(_contact()):
        embed_search_query("Jane Doe kubernetes", model, 4)

    assert model.seen == ["«name» kubernetes"]
