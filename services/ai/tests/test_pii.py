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


def test_adjacent_name_and_email_remain_separate_semantic_fields():
    text = "Priya Natarajan\npriya.n@example.org\nSoftware Engineer"
    masked, session = prepare_document(text)
    lines = masked.splitlines()
    assert len(lines) == 3
    assert ":PERSON:" in lines[0]
    assert ":EMAIL_ADDRESS:" in lines[1]
    assert lines[2] == "Software Engineer"
    assert session.restore(masked) == text


def test_two_column_headers_and_bullet_text_keep_resume_facts():
    text = (
        "JORDAN LEE      SKILLS\nProduct Designer       Figma\n"
        "• Shipped design systems for 20 product teams."
    )
    masked, session = prepare_document(text)
    assert "JORDAN LEE" not in masked
    for fact in ("SKILLS", "Product Designer", "Figma", "• Shipped"):
        assert fact in masked
    assert session.restore(masked) == text


def test_employment_month_ranges_are_not_phone_numbers():
    text = "Software Engineer\n08/2017 - 12/2020\nPhone: +44 20 7946 0958"
    masked, session = prepare_document(text)
    assert "08/2017 - 12/2020" in masked
    assert "+44 20 7946 0958" not in masked
    assert session.restore(masked) == text


def test_two_column_eval_preserves_employers_titles_and_bullet_verbs():
    text = (
        "JORDAN LEE                                   SKILLS\n"
        "Product Designer                             Figma, Sketch, user research,\n"
        "jordan.lee@example.net                       prototyping, HTML/CSS\n"
        "Portland, OR\nEXPERIENCE\n"
        "Brightline Studio | Senior Product Designer | 01/2021 - Present\n"
        "• Redesigned the onboarding flow for a fitness app, increasing week-one\n"
        "retention from 31% to 45%.\n"
        "• Ran 40+ moderated usability sessions and turned findings into a\n"
        "shared research repository.\n"
        "Pixel & Co. | Product Designer | 08/2017 - 12/2020\n"
        "• Shipped a design system adopted across 5 product teams.\n"
        "EDUCATION\nOregon State University, BFA Graphic Design, 2013-2017"
    )
    masked, session = prepare_document(text)
    for secret in ("JORDAN LEE", "jordan.lee@example.net"):
        assert secret not in masked
    for fact in (
        "SKILLS", "Product Designer", "Figma", "• Shipped",
        "08/2017 - 12/2020", "01/2021 - Present", "Oregon State University",
    ):
        assert fact in masked
    employer_field = masked.splitlines()[5].split(" | ")[0]
    assert session.restore(employer_field) == "Brightline Studio"
    assert session.restore(masked) == text


@pytest.mark.parametrize("copies", [1, 8])
def test_layout_segments_use_batched_nlp_without_reprocessing_each_segment(monkeypatch, copies):
    import pii

    engine = pii._analyzer().nlp_engine
    process_text = engine.process_text
    single_texts = []

    def record_single(text, language):
        single_texts.append(text)
        return process_text(text, language)

    monkeypatch.setattr(engine, "process_text", record_single)
    text = (
        "John Smith      SKILLS\nMaria Garcia\tPython APIs\n"
        "• David Chen\njohn.smith@example.test\n+44 20 7946 0958\n"
        "08/2017 - 12/2020\n"
    ) * copies
    masked, session = prepare_document(text)
    for contact in (
        "John Smith", "Maria Garcia", "David Chen", "john.smith@example.test",
        "+44 20 7946 0958",
    ):
        assert contact not in masked
    for fact in ("SKILLS", "Python APIs", "08/2017 - 12/2020"):
        assert fact in masked
    assert session.restore(masked) == text
    # The full document retains contact context; segment NLP runs as one batch.
    assert single_texts == [text]


def test_batched_detector_failure_does_not_expose_source(monkeypatch):
    import pii

    def broken_batch(*args, **kwargs):
        raise RuntimeError("John Smith john.smith@example.test")

    monkeypatch.setattr(pii._analyzer().nlp_engine, "process_batch", broken_batch)
    with pytest.raises(pii.PiiDetectionError) as failure:
        prepare_document("John Smith\njohn.smith@example.test")
    assert str(failure.value) == "Local contact detection is unavailable"
    assert failure.value.__suppress_context__
