"""Start the `ai-live` LiveKit Agents worker for live practice interviews.

Run with `python -m livekit.agents start live_interviews/worker.py`. The worker connects out to
LiveKit (LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET) and registers for explicit dispatch
under the agent name Rails puts in each join token; it serves no HTTP of its own. Each job
calls Rails over the internal boundary (INTERVIEW_RAILS_ORIGIN, INTERVIEW_SERVICE_SECRET),
reads inputs with the read-only database role and talks to OpenAI with OPENAI_API_KEY.
Tracing uses the shared Logfire setup (exported only when LOGFIRE_TOKEN is set): each job is one
content-free trace with its cost, flushed when the job shuts down.

On SIGTERM the worker drains: it takes no new interviews and exits once its running ones end, or
after DRAIN_SECONDS, whichever comes first. Deploys start the new worker before draining the old
one (infra/compose/restart-changed-services.sh), so nothing waits on the drain.
"""

import asyncio

from livekit.agents import AgentServer, AgentSession, JobContext, JobProcess
from livekit.plugins import openai

from database.live_interview_inputs import build_live_interview_input_reader
from live_interviews.agent import realtime_model_options, run_live_interview
from live_interviews.client import RailsLiveInterviewClient
from live_interviews.settings import AGENT_NAME, LiveInterviewSettings
from live_interviews.telemetry import configure_live_tracing
from settings import AISettings
from telemetry.tracing import flush_tracing


def prewarm(_proc: JobProcess) -> None:
    """Set up tracing while the interview process warms up, before any interview. It imports every
    AI agent module (for contact masking), which blocked a live room's audio loop for half a second
    when it ran at the start of the interview."""
    configure_live_tracing()


async def entrypoint(ctx: JobContext) -> None:
    configure_live_tracing()  # already done by prewarm; a no-op then
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


# Rails ends every live connection 45 minutes of wall clock after its first claim
# (LiveAllowance::CONNECTION_WALL_CLOCK); the extra 5 minutes let it wrap up.
DRAIN_SECONDS = 50 * 60

# One warm interview process instead of LiveKit's default of one per CPU, to save memory on the
# shared 2 GiB server. A second interview at the same time starts a process on demand (a second or so).
IDLE_PROCESSES = 1

server = AgentServer(drain_timeout=DRAIN_SECONDS, num_idle_processes=IDLE_PROCESSES, setup_fnc=prewarm)
server.rtc_session(entrypoint, agent_name=AGENT_NAME)
