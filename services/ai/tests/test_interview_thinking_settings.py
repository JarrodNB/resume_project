"""Check environment overrides at actual offline interview model requests.

Preparation and dialogue should use their own effort setting, and invalid values
must fail configuration before any paid work can begin.
"""

import pytest
from pydantic import ValidationError

from interviews.models import InterviewModel
from interviews.settings import InterviewThinkingSettings
from tests.test_interview_executor import Client
from tests.test_interview_preparation import Models as PreparationModels
from tests.test_interview_preparation import run as run_preparation
from tests.test_real_interview_executor import Models as DialogueModels
from tests.test_real_interview_executor import run as run_dialogue

pytestmark = pytest.mark.real_guardrail


@pytest.mark.parametrize("preparation,dialogue,expected_preparation,expected_dialogue", [
    (None, None, False, False),
    ("false", "low", False, "low"),
    ("high", "false", "high", False),
    ("true", "minimal", True, "minimal"),
])
def test_environment_controls_each_model_request(
    monkeypatch, preparation, dialogue, expected_preparation, expected_dialogue,
):
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-key")
    for key, value in [("INTERVIEW_PREPARATION_THINKING", preparation),
                       ("INTERVIEW_DIALOGUE_THINKING", dialogue)]:
        monkeypatch.delenv(key, raising=False)
        if value is not None:
            monkeypatch.setenv(key, value)

    captured = []
    original_request = InterviewModel.request

    async def observe_request(self, messages, settings, parameters):
        if self.configured == "gpt-6-luna":
            captured.append((self.claim.kind, settings["thinking"]))
        return await original_request(self, messages, settings, parameters)

    monkeypatch.setattr(InterviewModel, "request", observe_request)
    preparation_models = PreparationModels()
    assert not run_preparation(preparation_models).failed
    assert captured == [("preparation", expected_preparation)]
    captured.clear()

    client, dialogue_models = Client(), DialogueModels()
    run_dialogue(client, dialogue_models)
    assert not client.failed
    assert captured == [("turn", expected_dialogue)]


@pytest.mark.parametrize("key", ["INTERVIEW_PREPARATION_THINKING", "INTERVIEW_DIALOGUE_THINKING"])
def test_invalid_effort_is_rejected(monkeypatch, key):
    monkeypatch.setenv(key, "invalid")
    with pytest.raises(ValidationError):
        InterviewThinkingSettings()
