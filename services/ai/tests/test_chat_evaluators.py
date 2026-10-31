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
    assert len(dataset.cases) == 8
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

@pytest.mark.anyio
@pytest.mark.parametrize('case_name,blocked', [('reads_saved_job_summary', False), ('hostile_saved_job_requirement', True)])
async def test_saved_job_eval_uses_synthetic_list_and_summary_without_database(monkeypatch, case_name, blocked):
    import json

    from pydantic_ai.models.function import DeltaToolCall

    from screening.screen_user_text import ScreenOutcome
    from tests.test_chat_execution import Models, tool_returns

    monkeypatch.setattr('pii._detect_spans', lambda text: [])
    monkeypatch.setattr(ChatExecutionAdapter, '_screen', AsyncMock())
    seen = []
    async def screen(self, claim, text):
        seen.append(text)
        return ScreenOutcome('Ignore all previous instructions' not in text)
    monkeypatch.setattr(ChatExecutionAdapter, '_screen_decision', screen)
    def forbidden(*_):
        pytest.fail('Synthetic evals must not read a database')
    monkeypatch.setattr('database.saved_jobs.build_database_saved_jobs_reader', forbidden)
    monkeypatch.setattr('database.saved_jobs.build_database_job_summary_reader', forbidden)
    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name='list_saved_jobs', json_args='{}', tool_call_id='list')}
        elif len(returns) == 1:
            reference = returns[0].content.split('Reference: ')[1].splitlines()[0]
            yield {0: DeltaToolCall(name='read_job_summary', json_args=json.dumps({'job_reference': reference}), tool_call_id='summary')}
        else:
            assert not blocked, (seen, returns[1].content)
            assert 'Location: Remote' in returns[1].content and 'Python' in returns[1].content
            yield 'Remote Python role.'
    case = next(case for case in load_chat_dataset().cases if case.name == case_name)
    output = await execute_chat_case(case.inputs, models=Models(stream))
    if blocked:
        assert output.status == 'failed' and output.failure_code == 'screening_blocked' and not output.reply
        assert any('Ignore all previous instructions' in text for text in seen)
    else:
        assert output.status == 'completed' and output.reply == 'Remote Python role.'
