"""Serve interactive AI endpoints and supervise interview execution.

No provider client is constructed until service enablement and credentials pass.
Readiness exposes stable setup reasons, never credentials or exception contents.
"""
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from execution.runner import ExecutionRunner
from execution.stream_runtime import optional_streaming
from interviews.execution_adapter import InterviewExecutionAdapter


def configuration():
    """Return HTTP service configuration or an actionable, non-sensitive reason."""
    if os.getenv("AI_HTTP_ENABLED") != "true":
        return None, "runtime_disabled"
    if not os.getenv("INTERVIEW_SERVICE_SECRET", "").strip():
        return None, "service_secret_missing"
    if not all(os.getenv(name, "").strip() for name in ("OPENAI_API_KEY", "TYPESAFE_API_KEY")):
        return None, "provider_credentials_missing"
    origin = os.getenv("INTERVIEW_RAILS_ORIGIN", "http://api:3000")
    storage = set(filter(None, os.getenv("INTERVIEW_STORAGE_ORIGINS", "http://s3:9090").split(",")))
    if not storage:
        return None, "service_origins_invalid"
    for value in [origin, *storage]:
        try:
            parsed = urlsplit(value)
            _ = parsed.port
        except ValueError:
            return None, "service_origins_invalid"
        if (parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username
                or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
            return None, "service_origins_invalid"
    return (origin, storage), None


def create_app():
    @asynccontextmanager
    async def lifespan(app):
        app.state.execution_runner = None
        configured, app.state.reason = configuration()
        if configured is None:
            yield
            return
        from interviews.audio_providers import AudioProviders
        from interviews.client import RailsInterviewClient
        from interviews.live_transcription import CaptureOwner
        from interviews.models import InterviewModels
        from interviews.real import RealInterviewExecutor
        from telemetry.tracing import configure_tracing, flush_tracing

        configure_tracing()
        origin, storage_origins = configured
        async with (
            RailsInterviewClient(origin, os.environ["INTERVIEW_SERVICE_SECRET"], execution_mode="real") as rails,
            AudioProviders(rails, api_key=os.environ["OPENAI_API_KEY"]) as audio,
            InterviewModels(openai_key=os.environ["OPENAI_API_KEY"], typesafe_key=os.environ["TYPESAFE_API_KEY"]) as models,
        ):
            app.state.capture_owner = CaptureOwner(rails)
            with httpx.Client(trust_env=False, timeout=15, follow_redirects=False) as storage:
                executor = RealInterviewExecutor(rails, audio=audio, models=models,
                    storage_client=storage, allowed_origins=storage_origins, allow_http=True)
                runner = ExecutionRunner({"interviews": InterviewExecutionAdapter(rails, executor)})
                app.state.execution_runner = runner
                async with optional_streaming(app, runner,
                        enabled=os.getenv("AI_STREAMING_ENABLED") == "true",
                        redis_url=os.getenv("AI_STREAM_REDIS_URL"), rails_origin=origin,
                        secret=os.environ["INTERVIEW_SERVICE_SECRET"]):
                    try:
                        yield
                    finally:
                        app.state.capture_owner = None
                        await runner.close()
                        flush_tracing()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None,
                  telemetry={"exclude": lambda scope: scope.get("path") in {"/ready", "/health"}})
    from routes.executions import install_execution_routes
    install_execution_routes(app, secret=lambda: os.getenv("INTERVIEW_SERVICE_SECRET", ""))
    from routes.execution_streams import install_output_stream
    install_output_stream(app, allowed_origins=set(filter(None, os.getenv(
        "AI_BROWSER_ORIGINS", os.getenv("INTERVIEW_BROWSER_ORIGINS", "")).split(","))))
    from interviews.live_transcription import install_streaming
    install_streaming(app, allowed_origins=set(filter(None, os.getenv("INTERVIEW_BROWSER_ORIGINS", "").split(","))),
                      api_key=os.getenv("OPENAI_API_KEY", ""))

    @app.get("/health")
    async def health():
        return {"status": "alive", "service": "ai-http"}

    @app.get("/ready")
    async def ready():
        runner = getattr(app.state, "execution_runner", None)
        is_ready = bool(runner and runner.ready)
        reason = getattr(app.state, "reason", "runtime_disabled") or "execution_unavailable"
        return JSONResponse({"ready": is_ready, **({} if is_ready else {"reason": reason})},
                            status_code=200 if is_ready else 503)

    return app


app = create_app()
