"""Check environment tuning for interview references before any provider work starts."""
import pytest
from pydantic import ValidationError

from settings import load_settings


def test_default_similarity_when_environment_is_absent(monkeypatch):
    monkeypatch.delenv('INTERVIEW_REFERENCE_MIN_SIMILARITY', raising=False)
    assert load_settings().interview_reference_min_similarity == .65


@pytest.mark.parametrize('value', ['0', '0.8', '1'])
def test_environment_similarity_override(monkeypatch, value):
    monkeypatch.setenv('INTERVIEW_REFERENCE_MIN_SIMILARITY', value)
    assert load_settings().interview_reference_min_similarity == float(value)


@pytest.mark.parametrize('value', ['-0.01', '1.01', 'nan', 'inf', '-inf', 'invalid', ''])
def test_invalid_similarity_is_rejected(monkeypatch, value):
    monkeypatch.setenv('INTERVIEW_REFERENCE_MIN_SIMILARITY', value)
    with pytest.raises(ValidationError, match='interview_reference_min_similarity'):
        load_settings()
