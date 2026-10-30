"""Check synthetic continuity signals and production eval routing without paid providers."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from chat.execution import ChatExecutionAdapter
from evals.chat_evaluators import CareerChatOutcome, ChatEvalExpectations, ChatEvalOutput
from evals.run_chat_evals import execute_chat_case, load_chat_dataset
from tests.test_chat_execution import MemoryModels


@pytest.fixture
def anyio_backend():
    return "asyncio"


def test_chat_evaluation_labels_are_separate_and_bad_outputs_lose_scores():
    dataset = load_chat_dataset()
    assert len(dataset.cases) == 5
    case = dataset.cases[0]
    assert 'required_reply_terms' not in case.inputs.model_dump()
    evaluator = CareerChatOutcome()
    bad = evaluator.evaluate(SimpleNamespace(metadata=case.metadata,
        output=ChatEvalOutput(status='completed', reply='A different role.')))
    good = evaluator.evaluate(SimpleNamespace(metadata=case.metadata,
        output=ChatEvalOutput(status='completed', reply='Nurse')))
    assert bad['reply_continuity'] == 0 and good['reply_continuity'] == 1
    blocked = ChatEvalExpectations(expects_block=True)
    assert evaluator.evaluate(SimpleNamespace(metadata=blocked,
        output=ChatEvalOutput(status='failed', failure_code='screening_unavailable')))['expected_outcome'] == 0
    assert evaluator.evaluate(SimpleNamespace(metadata=blocked,
        output=ChatEvalOutput(status='failed', failure_code='screening_blocked')))['expected_outcome'] == 1


@pytest.mark.anyio
async def test_eval_uses_production_rolling_adapter_and_reports_real_attempt_usage(monkeypatch):
    monkeypatch.setattr('pii._detect_spans', lambda text: [])
    screen = AsyncMock()
    monkeypatch.setattr(ChatExecutionAdapter, '_screen', screen)
    case = load_chat_dataset().cases[1]
    models = MemoryModels()
    output = await execute_chat_case(case.inputs, models=models)
    assert output.status == 'completed' and output.summary == 'Rolling memory 1'
    assert output.known_cost_microdollars > 0 and output.accounting_complete
    assert 'nurse' in models.summary_inputs[0]
    assert 'Rolling memory 1' in models.reply_inputs[0]
    screen.assert_awaited_once()
