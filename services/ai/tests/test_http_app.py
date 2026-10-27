"""Check explicit real-process startup without contacting paid services."""
from fastapi.testclient import TestClient

from app import create_app


def test_disabled_real_process_is_alive_and_actionably_unready(monkeypatch):
    monkeypatch.delenv("AI_HTTP_ENABLED", raising=False)
    with TestClient(create_app()) as client:
        assert client.get("/health").json() == {"status": "alive", "service": "ai-http"}
        assert client.get("/ready").json() == {"ready": False, "reason": "runtime_disabled"}


def test_missing_keys_are_safe_readiness_failure_without_destroying_environment(monkeypatch):
    monkeypatch.setenv("AI_HTTP_ENABLED", "true")
    monkeypatch.setenv("INTERVIEW_SERVICE_SECRET", "synthetic-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-key")
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with TestClient(create_app()) as client:
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json() == {"ready": False, "reason": "provider_credentials_missing"}
        assert "synthetic" not in response.text
    import os
    assert os.environ["OPENAI_API_KEY"] == "synthetic-key"


def test_http_setup_rejects_malformed_origin(monkeypatch):
    from app import configuration
    monkeypatch.setenv("AI_HTTP_ENABLED", "true")
    monkeypatch.setenv("INTERVIEW_SERVICE_SECRET", "synthetic")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic")
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic")
    monkeypatch.setenv("INTERVIEW_RAILS_ORIGIN", "http://[invalid")
    assert configuration()[1] == "service_origins_invalid"


def test_real_parent_trace_masks_contacts_and_excludes_media_capabilities(monkeypatch):
    import json

    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    from telemetry.tracing import configure_tracing, flush_tracing
    from tests.test_interview_executor import Client, claim
    from tests.test_real_interview_executor import Models, run

    spans = InMemorySpanExporter()
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic")
    configure_tracing([SimpleSpanProcessor(spans)])
    request = claim()
    request.payload.fixture_context["names"] = ["Morgan Sample"]
    client = Client()
    run(client, Models(), request)
    assert len(client.accepted) == 1
    flush_tracing()
    finished = spans.get_finished_spans()
    assert any(span.name == "interview.operation" for span in finished)
    rendered = json.dumps([dict(span.attributes) for span in finished])
    assert "Morgan Sample" not in rendered
    assert "download_url" not in rendered and "Authorization" not in rendered
    assert all(span.attributes.get("interview_operation_id") == "op" for span in finished)


def test_health_probes_emit_no_native_fastapi_spans(monkeypatch):
    """Exercise actual HTTP telemetry, retaining spans for ordinary routes."""
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", provider)
    monkeypatch.setenv("AI_HTTP_ENABLED", "false")
    app = create_app()

    @app.get("/ordinary")
    async def ordinary():
        return {"ok": True}

    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/ready").status_code == 503
        assert exporter.get_finished_spans() == ()
        assert client.get("/ordinary").status_code == 200
    assert any(span.name == "GET /ordinary" for span in exporter.get_finished_spans())
    provider.shutdown()


def test_enabled_http_configuration_is_not_limited_to_development(monkeypatch):
    from app import configuration

    monkeypatch.setenv("AI_HTTP_ENABLED", "true")
    monkeypatch.setenv("LOGFIRE_ENVIRONMENT", "production")
    monkeypatch.setenv("INTERVIEW_SERVICE_SECRET", "synthetic-service-secret")
    monkeypatch.setenv("OPENAI_API_KEY", "synthetic-provider-key")
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-screening-key")
    monkeypatch.setenv("INTERVIEW_RAILS_ORIGIN", "https://api.example.test")
    monkeypatch.setenv("INTERVIEW_STORAGE_ORIGINS", "https://storage.example.test")

    configured, reason = configuration()
    assert reason is None
    assert configured == ("https://api.example.test", {"https://storage.example.test"})
