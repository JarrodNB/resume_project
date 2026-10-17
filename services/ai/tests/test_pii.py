"""Check the local privacy boundary with synthetic documents and real detection."""

import pickle

import pytest
from pydantic import BaseModel

from pii import PiiRestorationError, prepare_document


@pytest.mark.parametrize("name", ["John Smith", "Maria Garcia", "David Chen"])
def test_real_detection_round_trips_contact_and_preserves_resume_facts(name):
    text = (
        f"{name}\nSoftware engineer\nContact: john.smith@example.com\n"
        "Phone: +44 20 7946 0958\nBuilt Python APIs at Microsoft in 2023."
    )
    masked, session = prepare_document(text)
    for value in (name, "john.smith@example.com", "+44 20 7946 0958"):
        assert value not in masked
    assert "Python APIs" in masked
    assert "Microsoft" in masked
    assert "2023" in masked
    assert session.restore(masked) == text
    assert session.mask(text) == masked


def test_repeat_case_variants_literals_and_known_contact_compose_exactly():
    text = "ALEX DOE / Alex Doe / Alex Doe / «name» / «pii:old:PERSON:1»"
    masked, session = prepare_document(text, names=["Alex Doe"])
    assert "Alex Doe" not in masked and "ALEX DOE" not in masked
    assert session.restore(masked) == text
    tokens = masked.split(" / ")
    assert tokens[1] == tokens[2]
    assert tokens[0] != tokens[1]


def test_nested_structured_restore_and_unknown_generated_tokens_fail():
    class Result(BaseModel):
        highlights: list[str]

    masked, session = prepare_document("Email: person@example.com")
    assert session.restore({"x": [Result(highlights=[masked]), (masked,)]}) == {
        "x": [Result(highlights=["Email: person@example.com"]), ("Email: person@example.com",)]
    }
    with pytest.raises(PiiRestorationError, match="unresolved"):
        session.restore("«pii:invented:PERSON:99»")


def test_sessions_are_isolated_and_do_not_reveal_map_in_repr():
    masked, first = prepare_document("person@example.com")
    _, second = prepare_document("other@example.com")
    assert "person@example.com" not in repr(first)
    with pytest.raises(PiiRestorationError):
        second.restore(masked)
    assert first.restore(masked) == "person@example.com"


def test_no_entities_is_valid():
    text = "Built Python APIs; 40% faster in 2023."
    masked, session = prepare_document(text)
    assert masked == text
    assert session.restore(masked) == text


def test_private_map_cannot_be_serialized():
    _, session = prepare_document("person@example.com")
    with pytest.raises(TypeError, match="memory"):
        pickle.dumps(session)


def test_short_known_names_do_not_replace_parts_of_resume_words():
    masked, session = prepare_document("Annual review by Ann.", names=["Ann"])
    assert "Annual review" in masked
    assert session.restore(masked) == "Annual review by Ann."


@pytest.mark.parametrize("phone", ["+1 415-555-2671", "+65 8123 4567", "+91 98765 43210"])
def test_international_phones_are_masked_without_profile(phone):
    text = f"Phone: {phone}"
    masked, session = prepare_document(text)
    assert phone not in masked
    assert session.restore(masked) == text


def test_detector_failure_is_safe(monkeypatch):
    import pii

    def broken():
        raise RuntimeError("sensitive-document-text")

    monkeypatch.setattr(pii, "_analyzer", broken)
    with pytest.raises(pii.PiiDetectionError) as failure:
        prepare_document("sensitive-document-text")
    assert "sensitive" not in str(failure.value)
    assert failure.value.__suppress_context__


def test_missing_model_never_attempts_download(monkeypatch):
    import spacy

    import pii

    def missing(*args, **kwargs):
        raise OSError("Missing model")

    pii._analyzer.cache_clear()
    monkeypatch.setattr(spacy, "load", missing)
    with pytest.raises(pii.PiiDetectionError):
        prepare_document("person@example.com")
    pii._analyzer.cache_clear()


def test_analysis_never_refreshes_public_suffix_list_online(monkeypatch):
    import requests

    attempts = []

    def network_request(*args, **kwargs):
        attempts.append(True)
        raise AssertionError("Detection must stay local")

    monkeypatch.setattr(requests.Session, "request", network_request)
    masked, session = prepare_document("person@example.com")
    assert "person@example.com" not in masked
    assert session.restore(masked) == "person@example.com"
    assert not attempts


def test_private_domain_email_addresses_stay_private():
    masked, session = prepare_document("Email: alex@example.test")
    assert "alex@example.test" not in masked
    assert session.restore(masked) == "Email: alex@example.test"
