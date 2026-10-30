"""Verify spoken turns reuse bounded Rails-owned context without classification."""

from interviews.client import Claim
from tests.test_interview_executor import Client, claim
from tests.test_real_interview_executor import Models, run


def prepared_claim(*, approved=True, dialogue=None, history=None):
    data = claim(history=history).model_dump()
    del data['payload']['fixture_context']
    data['payload']['interview_context'] = {
        'version': 1,
        'personal_evidence': {'sources': [{'type': 'projects', 'id': 'project',
            'field': 'description', 'text': 'Built the unique scheduling library example.',
            'screened': approved}]},
        'fictional_role': {'title': 'Imagined operations engineer', 'requirements': ['Lead a laboratory']},
    }
    data['payload']['current_dialogue'] = dialogue or [{'kind': 'opening', 'content': 'Describe a project.'}]
    return Claim.model_validate(data)


def test_approved_library_and_saved_dialogue_are_not_sent_to_screening(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    client, models = Client(), Models()
    request = prepared_claim(dialogue=[
        {'kind': 'opening', 'content': 'Describe a project.'},
        {'kind': 'answer', 'content': 'Previously accepted candidate answer.'},
        {'kind': 'follow_up', 'content': 'What changed for the team?'},
    ])
    run(client, models, request)
    assert not client.failed
    screens = [text for name, text in models.prompts if name == 'jev-1.13.0']
    assert screens == []
    model_input = models.prompts[-1][1]
    assert 'unique scheduling' not in model_input
    assert 'Previously accepted' in model_input
    assert 'SystemPromptPart' in model_input
    assert '"screened"' not in model_input
    assert '"personal_evidence"' not in model_input


class ApprovalClient(Client):
    async def screen_library(self, request, source_indices):
        self.calls.append(('screen_library', source_indices))
        return source_indices


def test_unchecked_fields_do_not_gain_screening_approvals_during_spoken_turns(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    client, models = ApprovalClient(), Models()
    run(client, models, prepared_claim(approved=False))
    assert not client.failed and client.accepted
    assert not any(call[0] == 'screen_library' for call in client.calls)
    screens = [text for name, text in models.prompts if name == 'jev-1.13.0']
    assert screens == []
    models.prompts.clear()
    run(client, models, prepared_claim(approved=True, history=client.accepted[-1]['model_history'],
        dialogue=[{'kind': 'opening', 'content': 'Describe a project.'},
                  {'kind': 'answer', 'content': 'I shortened the wait.'},
                  {'kind': 'follow_up', 'content': 'How did you measure it?'}]))
    assert not client.failed
    assert not any(name == 'jev-1.13.0' for name, _ in models.prompts)
    history = client.accepted[-1]['model_history']
    assert history == []
    assert 'unique scheduling' not in str(history)


def test_spoken_turn_never_requests_a_library_approval_receipt(monkeypatch):
    class NoApproval(ApprovalClient):
        async def screen_library(self, request, source_indices):
            raise AssertionError('Spoken turns must not approve unscreened fields')

    client, models = NoApproval(), Models()
    run(client, models, prepared_claim(approved=False))
    assert client.accepted and not client.failed


def test_legacy_private_envelopes_and_acknowledgements_never_reach_jev_or_model(monkeypatch):
    import json

    from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, UserPromptPart
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    old = json.loads(ModelMessagesTypeAdapter.dump_json([
        ModelRequest(parts=[UserPromptPart('private old envelope marker')])]))
    client, models = Client(), Models()
    run(client, models, prepared_claim(history=old, dialogue=[
        {'kind': 'opening', 'content': 'Current question'},
        {'kind': 'answer', 'content': 'Previously accepted answer'},
        {'kind': 'follow_up', 'content': 'Follow-up question'},
    ]))
    assert not client.failed and client.accepted
    assert all('private old envelope marker' not in text for _, text in models.prompts)
    assert 'Previously accepted answer' in models.prompts[-1][1]


def test_assembled_context_limit_fails_before_screening(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    request = prepared_claim()
    request.payload.current_dialogue[0].content = 'x' * 120001
    client, models = Client(), Models()
    run(client, models, request)
    assert client.failed == [('context_limit', False)]
    assert not models.prompts


def test_unchecked_library_is_used_without_granting_approval(monkeypatch):
    client, models = ApprovalClient(), Models(blocked=True)
    run(client, models, prepared_claim(approved=False))
    assert client.accepted and not client.failed
    assert not any(call[0] == 'screen_library' for call in client.calls)
    assert {name for name, _ in models.prompts} == {'gpt-6-luna'}


def test_approved_preparation_requires_no_library_classifier(monkeypatch):
    from tests.test_interview_preparation import Models as PreparationModels
    from tests.test_interview_preparation import preparation_claim
    from tests.test_interview_preparation import run as prepare
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    request = preparation_claim()
    request.payload.preparation_context['sources'][0]['screened'] = True
    request.payload.preparation_context['career_focus'] = ''
    models = PreparationModels()
    client = prepare(models, request)
    assert not client.failed and client.accepted
    assert [name for name, _, _ in models.requests] == ['gpt-6-luna']
    assert 'SystemPromptPart' in models.requests[0][1]


def test_contact_masking_happens_before_delimiter_escaping(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    request = prepared_claim()
    context = request.payload.interview_context.personal_evidence
    context['names'] = ['Morgan & Sample']
    context['sources'][0]['text'] = 'Morgan & Sample built the scheduling tool.'
    client, models = Client(), Models()
    run(client, models, request)
    assert not client.failed and client.accepted
    for _, prompt in models.prompts:
        assert 'Morgan & Sample' not in prompt
        assert 'Morgan &amp; Sample' not in prompt


def test_synthetic_fixture_role_and_career_are_preserved(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    request = claim()
    request.payload.fixture_context.update(role='Fictional software engineer', career='Built a team scheduling tool.')
    client, models = Client(), Models()
    run(client, models, request)
    assert not client.failed and client.accepted
    assert 'Fictional software engineer' not in models.prompts[-1][1]
    assert 'Built a team scheduling tool' not in models.prompts[-1][1]
    assert 'Synthetic fixture context' not in models.prompts[-1][1]


def test_earlier_dialogue_budget_has_specific_failure_without_model_calls(monkeypatch):
    from interviews.client import EarlierDialogue

    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    request = prepared_claim()
    request.payload.earlier_dialogue = EarlierDialogue.model_validate({
        'version': 1, 'character_budget': 12000, 'omitted_question_positions': [],
        'groups': [{'question_position': 0, 'messages': [
            {'kind': 'opening', 'content': 'Earlier question'},
            {'kind': 'answer', 'content': 'x' * 12001},
        ]}],
    })
    client, models = Client(), Models()
    run(client, models, request)
    assert client.failed == [('context_limit', False)]
    assert not client.accepted and not models.prompts


def test_aggregate_dialogue_budget_has_specific_failure_without_model_calls(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    monkeypatch.setattr('interviews.conversation.MAX_PROMPT_TEXT', 1000)
    monkeypatch.setattr('interviews.real.MAX_PROMPT_TEXT', 1000)
    request = prepared_claim(dialogue=[
        {'kind': 'opening', 'content': 'Describe a project.'},
        {'kind': 'answer', 'content': 'Previously accepted detail. ' * 60},
        {'kind': 'follow_up', 'content': 'What changed?'},
    ])
    client, models = Client(), Models()
    run(client, models, request)
    assert client.failed == [('context_limit', False)]
    assert not client.accepted and not models.prompts


def test_saved_avoidance_reaches_followups_without_new_classification(monkeypatch):
    monkeypatch.setenv('TYPESAFE_API_KEY', 'synthetic')
    client, models = Client(), Models()
    request = prepared_claim()
    request.payload.interview_context.personal_evidence['avoided_questions'] = ['Describe an old calibration challenge?']
    run(client, models, request)
    assert not client.failed
    assert 'Describe an old calibration challenge?' not in models.prompts[-1][1]
    assert all('Describe an old calibration challenge?' not in text
               for name, text in models.prompts if name == 'jev-1.13.0')
