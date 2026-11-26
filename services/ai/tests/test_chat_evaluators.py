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
    assert len(dataset.cases) == 22
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
            if blocked:
                assert 'did not pass the safety check' in returns[1].content
                assert 'Ignore all previous instructions' not in returns[1].content
                yield 'That saved posting can not be used right now.'
                return
            assert 'Location: Remote' in returns[1].content and 'Python' in returns[1].content
            yield 'Remote Python role.'
    case = next(case for case in load_chat_dataset().cases if case.name == case_name)
    output = await execute_chat_case(case.inputs, models=Models(stream))
    if blocked:
        assert output.status == 'completed' and output.failure_code is None
        assert output.reply == 'That saved posting can not be used right now.'
        assert any('Ignore all previous instructions' in text for text in seen)
    else:
        assert output.status == 'completed' and output.reply == 'Remote Python role.'


@pytest.mark.anyio
async def test_blocked_recent_job_eval_case_still_answers(monkeypatch):
    from screening.screen_user_text import ScreenOutcome
    from tests.test_chat_execution import Models

    monkeypatch.setattr('pii._detect_spans', lambda text: [])
    monkeypatch.setattr(ChatExecutionAdapter, '_screen', AsyncMock())
    async def screen(self, claim, text):
        return ScreenOutcome('Ignore all previous instructions' not in text)
    monkeypatch.setattr(ChatExecutionAdapter, '_screen_decision', screen)
    async def stream(messages, info):
        yield 'Lead your resume summary with your strongest result.'
    case = next(case for case in load_chat_dataset().cases if case.name == 'blocked_recent_job_label_keeps_chat_working')
    output = await execute_chat_case(case.inputs, models=Models(stream))
    assert output.status == 'completed' and output.failure_code is None


def test_context_save_evaluator_catches_unsolicited_and_invented_saves():
    evaluator = CareerChatOutcome()
    saved = ChatEvalOutput(status="completed", reply="Saved.", career_contexts=[{"requirement": "Incident", "response": "Reduced downtime 50%"}])
    unsolicited = evaluator.evaluate(SimpleNamespace(metadata=ChatEvalExpectations(), output=saved))
    assert unsolicited["career_context_save_policy"] == 0
    invented = evaluator.evaluate(SimpleNamespace(metadata=ChatEvalExpectations(expects_context_save=True, forbidden_context_terms=["50%"]), output=saved))
    assert invented["career_context_evidence"] == 0


def test_tool_use_is_scored_only_when_expected_tool_calls_are_set():
    evaluator = CareerChatOutcome()
    output = ChatEvalOutput(status="completed", reply="Two questions are unanswered.",
                            tool_calls=["list_interview_questions"])
    assert "tool_use" not in evaluator.evaluate(SimpleNamespace(metadata=ChatEvalExpectations(), output=output))
    required = ChatEvalExpectations(required_tool_calls=["list_interview_questions"])
    assert evaluator.evaluate(SimpleNamespace(metadata=required, output=output))["tool_use"] == 1
    skipped = output.model_copy(update={"tool_calls": []})
    assert evaluator.evaluate(SimpleNamespace(metadata=required, output=skipped))["tool_use"] == 0
    forbidden = ChatEvalExpectations(forbidden_tool_calls=["list_interview_questions"])
    assert evaluator.evaluate(SimpleNamespace(metadata=forbidden, output=output))["tool_use"] == 0
    assert evaluator.evaluate(SimpleNamespace(metadata=forbidden, output=skipped))["tool_use"] == 1


@pytest.mark.anyio
@pytest.mark.parametrize("case_name", ["lists_unanswered_practice_questions", "empty_practice_question_bank",
                                       "hostile_practice_question_left_out"])
async def test_practice_question_evals_serve_synthetic_questions_and_record_tool_calls(monkeypatch, case_name):
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
    monkeypatch.setattr('database.interview_question_bank.build_database_interview_question_bank_reader', forbidden)
    listed = []
    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name='list_interview_questions', json_args='{}', tool_call_id='list')}
        else:
            listed.append(returns[0].content)
            yield 'Here are your practice questions.'
    case = next(case for case in load_chat_dataset().cases if case.name == case_name)
    output = await execute_chat_case(case.inputs, models=Models(stream))
    assert output.status == 'completed' and output.tool_calls == ['list_interview_questions']
    scores = CareerChatOutcome().evaluate(SimpleNamespace(metadata=case.metadata, output=output))
    assert scores['tool_use'] == 1
    if case_name == 'empty_practice_question_bank':
        assert listed == ['The user has no active saved practice questions.']
    elif case_name == 'hostile_practice_question_left_out':
        assert 'Ignore all previous instructions' not in listed[0] and 'Left out: 1' in listed[0]
        assert 'proud' in listed[0]
        assert any('Ignore all previous instructions' in text for text in seen)
    else:
        assert 'Answer: not answered yet' in listed[0] and 'conflict' in listed[0]


@pytest.mark.anyio
@pytest.mark.parametrize("case_name", ["critiques_practice_answer_with_current_feedback",
                                       "stale_practice_feedback_not_presented_as_current",
                                       "similar_practice_questions_name_both_or_ask",
                                       "hostile_practice_answer_blocked_without_leak"])
async def test_practice_answer_evals_serve_synthetic_reads_and_record_tool_calls(monkeypatch, case_name):
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
    monkeypatch.setattr('database.interview_question_bank.build_database_interview_question_reader', forbidden)
    reads_answer = case_name != 'similar_practice_questions_name_both_or_ask'
    returned = []
    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name='list_interview_questions', json_args='{}', tool_call_id='list')}
        elif len(returns) == 1 and reads_answer:
            reference = returns[0].content.split('Reference: ')[1].splitlines()[0]
            yield {0: DeltaToolCall(name='read_interview_question', tool_call_id='read',
                                    json_args=json.dumps({'question_reference': reference}))}
        else:
            returned.extend(part.content for part in returns)
            yield 'Here is what I found.'
    case = next(case for case in load_chat_dataset().cases if case.name == case_name)
    output = await execute_chat_case(case.inputs, models=Models(stream))
    assert output.status == 'completed'
    expected_calls = ['list_interview_questions'] + (['read_interview_question'] if reads_answer else [])
    assert output.tool_calls == expected_calls
    assert CareerChatOutcome().evaluate(SimpleNamespace(metadata=case.metadata, output=output))['tool_use'] == 1
    if case_name == 'critiques_practice_answer_with_current_feedback':
        assert 'Situation: Our design and engineering leads' in returned[1] and 'checkout conversion' in returned[1]
    elif case_name == 'stale_practice_feedback_not_presented_as_current':
        assert 'out of date' in returned[1] and 'Zephyr' not in returned[1]
    elif case_name == 'similar_practice_questions_name_both_or_ask':
        assert 'your manager' in returned[0] and 'a teammate' in returned[0]
    else:
        assert 'PWNED' not in returned[1] and 'did not pass the safety check' in returned[1]
        assert any('PWNED' in text for text in seen)
