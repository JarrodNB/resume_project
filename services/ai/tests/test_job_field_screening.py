"""Saved Job approvals cover exact used fields, not unrelated text or changed values."""

import asyncio
import json
from pathlib import Path

import pytest

from schemas.gap_analysis_context import JobToAnalyze
from screening.job_fields import field_fingerprint, screen_job_fields, screen_job_fields_async
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session


def test_fingerprints_match_shared_ruby_contract_vectors():
    cases = json.loads((Path(__file__).parent / "fixtures/job_field_fingerprints.json").read_text())
    for case in cases:
        assert field_fingerprint(case["value"]) == case["sha256"]


@pytest.mark.parametrize("asynchronous", [False, True])
def test_reports_every_pending_field_and_reuses_only_exact_values(asynchronous):
    job = JobToAnalyze(id="job", title="Engineer", company="Owned company", requirements=["Python", "SQL"],
        nice_to_haves=["Cloud"], responsibilities=["Hidden duties"], screened_fields=["company"])
    calls = []

    def classify(text):
        calls.append(text)
        return ScreenOutcome(True)

    async def classify_async(text):
        return classify(text)

    def check():
        if asynchronous:
            return asyncio.run(screen_job_fields_async(job, classify_async, approved_sources=["exact source"]))
        return screen_job_fields(job, classify, approved_sources=["exact source"])

    with screening_session() as session:
        assert check().allowed
        assert session.job_screening[0].fields == {
            name: field_fingerprint(getattr(job, name)) for name in ("title", "requirements", "nice_to_haves")}
        assert "exact source" in session.allowed_sources
        assert check() is True
        assert len(calls) == 1
        job.requirements.reverse()
        assert check().allowed
        assert len(calls) == 2
        assert set(session.job_screening[-1].fields) == {"requirements"}
    assert "Owned company" not in calls[0] and "Hidden duties" not in calls[0]
    assert "screened_fields" not in job.model_dump_json()


@pytest.mark.parametrize("decision", [ScreenOutcome(False), ScreenOutcome(False, unchecked=True)])
def test_failed_group_grants_no_partial_job_approval(decision):
    job = JobToAnalyze(id="job", title="Engineer", requirements=["Python"])
    with screening_session() as session:
        assert screen_job_fields(job, lambda _: decision, approved_sources=["source"]) is decision
        assert not session.job_screening
        assert not session.allowed_sources


def test_blank_unused_fields_do_not_earn_approval():
    job = JobToAnalyze(id="job", title="Engineer", company=None, requirements=[], nice_to_haves=["  "])
    with screening_session() as session:
        screen_job_fields(job, lambda _: True, approved_sources=["source"])
        assert set(session.job_screening[0].fields) == {"title"}
