"""Keep runtime readiness closed when owned interview reads cannot connect."""

import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def preserve_environment():
    with patch.dict(os.environ, dict(os.environ), clear=True):
        yield


@pytest.mark.parametrize("runtime", ["fixture", "real"])
def test_database_outage_is_not_reported_ready(monkeypatch, runtime):
    import database.interview_inputs

    monkeypatch.setattr(
        database.interview_inputs, "interview_database_ready", lambda _: False, raising=False
    )
    if runtime == "fixture":
        from interviews.fixture_app import RuntimeSettings, create_app

        app = create_app(
            RuntimeSettings(True, "http://rails.test", "secret", frozenset({"http://storage.test"}))
        )
    else:
        from app import create_app

        for name in ("AI_HTTP_ENABLED",):
            monkeypatch.setenv(name, "true")
        for name in ("INTERVIEW_SERVICE_SECRET", "OPENAI_API_KEY", "TYPESAFE_API_KEY"):
            monkeypatch.setenv(name, "synthetic-offline")
        monkeypatch.setenv("AI_STREAMING_ENABLED", "false")
        app = create_app()
    with TestClient(app) as client:
        assert client.get("/ready").status_code == 503
        assert client.get("/ready").json()["reason"] == "database_unavailable"
        monkeypatch.setattr(database.interview_inputs, "interview_database_ready", lambda _: True)
        assert client.get("/ready").json() == {"ready": True}
