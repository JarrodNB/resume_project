"""Run isolated offline interview fixtures as a separate test-support HTTP process.

This entrypoint never loads worker settings, provider credentials or remote tracing.
Health routes inspect process/dependency state without claiming work themselves.
"""

import asyncio
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from execution.runner import ExecutionRunner
from interviews.execution_adapter import InterviewExecutionAdapter


@dataclass(frozen=True)
class RuntimeSettings:
    enabled: bool
    rails_origin: str
    secret: str
    storage_origins: frozenset[str]
    scenario: str = "normal"

    @classmethod
    def from_environment(cls):
        """Read only dedicated fake-runtime settings; reject provider selection."""
        settings = cls(
            enabled=os.environ.get("INTERVIEW_FAKE_RUNTIME_ENABLED") == "true",
            rails_origin=os.environ.get("INTERVIEW_RAILS_ORIGIN", "http://api:3000"),
            secret=os.environ.get("INTERVIEW_SERVICE_SECRET", ""),
            storage_origins=frozenset(filter(None, os.environ.get(
                "INTERVIEW_STORAGE_ORIGINS", "http://s3:9090").split(","))),
            scenario=os.environ.get("INTERVIEW_FAKE_SCENARIO", "normal"),
        )
        if settings.enabled and (not settings.secret or not settings.storage_origins):
            raise ValueError("Interview service secret and storage origins are required")
        for origin in [settings.rails_origin, *settings.storage_origins]:
            parsed = urlsplit(origin)
            if (parsed.scheme not in {"http", "https"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.path not in {"", "/"}
                    or parsed.query or parsed.fragment):
                raise ValueError("Configure explicit service and storage origins")
        if os.environ.get("INTERVIEW_PROVIDER_MODE", "fake") != "fake":
            raise ValueError("Only fake interview providers are implemented")
        return settings


def isolate_fake_process() -> None:
    """Disable SDK model requests and remote telemetry in this dedicated process."""
    from pydantic_ai import models

    models.ALLOW_MODEL_REQUESTS = False
    for key in list(os.environ):
        if key in {"LOGFIRE_TOKEN", "OPENAI_API_KEY", "TYPESAFE_API_KEY"} or key.startswith(
                "OTEL_EXPORTER_"):
            os.environ.pop(key, None)
    os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"
    os.environ["OTEL_SDK_DISABLED"] = "true"


def create_app(settings: RuntimeSettings | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        isolate_fake_process()
        configured = settings or RuntimeSettings.from_environment()
        app.state.execution_runner = None
        app.state.service_secret = configured.secret
        if configured.enabled:
            from database.interview_inputs import build_interview_input_reader
            from settings import AISettings
            database_settings = AISettings()
            app.state.database_settings = database_settings
            from interviews.client import RailsInterviewClient
            from interviews.executor import InterviewExecutor

            async with RailsInterviewClient(configured.rails_origin, configured.secret) as client:
                with httpx.Client(trust_env=False, timeout=15, follow_redirects=False) as storage:
                    executor = InterviewExecutor(
                        client, storage_client=storage,
                        allowed_origins=set(configured.storage_origins), allow_http=True,
                        scenario=configured.scenario, input_reader=build_interview_input_reader(database_settings),
                    )
                    runner = ExecutionRunner({"interviews": InterviewExecutionAdapter(client, executor)})
                    app.state.execution_runner = runner
                    try:
                        yield
                    finally:
                        await runner.close()
        else:
            yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    from routes.executions import install_execution_routes
    install_execution_routes(app, secret=lambda: getattr(app.state, "service_secret", ""))

    @app.get("/health")
    async def health():
        return {"status": "alive", "provider_mode": "fake"}

    @app.get("/ready")
    async def ready():
        runner = getattr(app.state, "execution_runner", None)
        ready = bool(runner and runner.ready)
        reason = "runtime_disabled"
        if ready:
            from database.interview_inputs import interview_database_ready
            ready = await asyncio.to_thread(interview_database_ready, app.state.database_settings)
            if not ready:
                reason = "database_unavailable"
        return JSONResponse({"ready": ready, **({} if ready else {"reason": reason})}, status_code=200 if ready else 503)

    return app


app = create_app()
