"""Supervise explicitly enabled real interviews in a separate development process.

No provider client is constructed until dedicated enablement and credentials pass.
Readiness exposes stable setup reasons, never credentials or exception contents.
"""
import os
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from interviews.runtime import RecoveryRuntime


def configuration():
    """Return dedicated configuration or an actionable, non-sensitive reason."""
    if os.getenv("INTERVIEW_REAL_RUNTIME_ENABLED") != "true":
        return None, "runtime_disabled"
    if os.getenv("INTERVIEW_ENVIRONMENT") != "development":
        return None, "development_only"
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
        app.state.runtime = None
        configured, app.state.reason = configuration()
        if configured is None:
            yield
            return
        from interviews.audio_providers import AudioProviders
        from interviews.client import RailsInterviewClient
        from interviews.models import InterviewModels
        from interviews.real import RealInterviewExecutor
        from worker.tracing import configure_tracing, flush_tracing

        configure_tracing()
        origin, storage_origins = configured
        async with (
            RailsInterviewClient(origin, os.environ["INTERVIEW_SERVICE_SECRET"], execution_mode="real") as rails,
            AudioProviders(rails, api_key=os.environ["OPENAI_API_KEY"]) as audio,
            InterviewModels(openai_key=os.environ["OPENAI_API_KEY"], typesafe_key=os.environ["TYPESAFE_API_KEY"]) as models,
        ):
            with httpx.Client(trust_env=False, timeout=15, follow_redirects=False) as storage:
                executor = RealInterviewExecutor(rails, audio=audio, models=models,
                    storage_client=storage, allowed_origins=storage_origins, allow_http=True)
                runtime = RecoveryRuntime(rails, executor)
                app.state.runtime = runtime
                await runtime.start()
                try:
                    yield
                finally:
                    await runtime.stop()
                    flush_tracing()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health")
    async def health():
        return {"status": "alive", "provider_mode": "real"}

    @app.get("/ready")
    async def ready():
        runtime = getattr(app.state, "runtime", None)
        is_ready = bool(runtime and runtime.ready)
        reason = getattr(app.state, "reason", "runtime_disabled") or "rails_unavailable"
        return JSONResponse({"ready": is_ready, **({} if is_ready else {"reason": reason})},
                            status_code=200 if is_ready else 503)

    return app


app = create_app()
