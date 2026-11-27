"""Fixed names and environment settings for the live interview agent (ai-live).

The agent name must match Rails (`Interviews::JoinLiveService::AGENT_NAME`), because Rails'
join token asks LiveKit to dispatch exactly that agent. The realtime and transcription models
are fixed too: Rails bills only these two (`Interviews::LiveConversationBill::MODELS`) and
refuses a heartbeat that names any other model, so they are not environment settings. Each
persona always speaks with the same voice. LiveKit itself reads LIVEKIT_URL, LIVEKIT_API_KEY
and LIVEKIT_API_SECRET.
"""

from pydantic_settings import BaseSettings

from interviews.live_transcription import MODEL as LIVE_TRANSCRIPTION_MODEL

AGENT_NAME = "careerdrafter-live-interviewer"

# The realtime speech model, and the model that captions what the candidate says (the same one
# the turn-based live captions use). Changing either needs Rails' bill and reservation updated too.
REALTIME_MODEL = "gpt-realtime-2.1-mini"
TRANSCRIPTION_MODEL = LIVE_TRANSCRIPTION_MODEL

# One OpenAI realtime voice per interviewer persona.
PERSONA_VOICES = {"maya": "marin", "daniel": "cedar", "priya": "shimmer"}


class LiveInterviewSettings(BaseSettings):
    """The Rails boundary, read from the process environment."""

    interview_rails_origin: str = "http://api:3000"
    interview_service_secret: str = ""
