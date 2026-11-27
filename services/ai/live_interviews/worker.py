"""Start the `ai-live` LiveKit Agents worker for live practice interviews.

Run with `python -m livekit.agents start live_interviews/worker.py`. The worker connects out to
LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) and registers for explicit dispatch
under the agent name Rails puts in each join token; it serves no HTTP of its own. Each job
calls Rails over the internal boundary (INTERVIEW_RAILS_ORIGIN, INTERVIEW_SERVICE_SECRET),
reads inputs with the read-only database role and talks to OpenAI with OPENAI_API_KEY.
Tracing uses the shared Logfire setup (exported only when LOGFIRE_TOKEN is set): each job is one
content-free trace with its cost, flushed when the job shuts down.
"""

import asyncio

from livekit.agents import AgentServer, AgentSession, JobContext
from livekit.plugins import openai

from database.live_interview_inputs import build_live_interview_input_reader
from live_interviews.agent import realtime_model_options, run_live_interview
from live_interviews.client import RailsLiveInterviewClient
from live_interviews.settings import AGENT_NAME, LiveInterviewSettings
from live_interviews.telemetry import configure_live_tracing
from settings import AISettings
from telemetry.tracing import flush_tracing


async def entrypoint(ctx: JobContext) -> None:
    configure_live_tracing()
    settings = LiveInterviewSettings()

    def make_session(persona: str) -> AgentSession:
        return AgentSession(llm=openai.realtime.RealtimeModel(**realtime_model_options(persona)))

    await run_live_interview(
        ctx,
        rails=RailsLiveInterviewClient(settings.interview_rails_origin, settings.interview_service_secret),
        read_inputs=build_live_interview_input_reader(AISettings()),
        make_session=make_session,
    )

    async def flush() -> None:  # after run_live_interview's own shutdown callback ends the session span
        await asyncio.to_thread(flush_tracing)

    ctx.add_shutdown_callback(flush)


server = AgentServer()
server.rtc_session(entrypoint, agent_name=AGENT_NAME)
