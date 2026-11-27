"""Fixed names and environment settings for the live interview agent (ai-live).

The agent name must match Rails (`Interviews::JoinLiveService::AGENT_NAME`), because Rails'
join token asks LiveKit to dispatch exactly that agent. Each persona always speaks with the same
voice. LiveKit itself reads LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET.
"""

from pydantic_settings import BaseSettings

from interviews.live_transcription import MODEL as LIVE_TRANSCRIPTION_MODEL

AGENT_NAME = "careerdrafter-live-interviewer"

# One OpenAI realtime voice per interviewer persona.
PERSONA_VOICES = {"maya": "marin", "daniel": "cedar", "priya": "shimmer"}


class LiveInterviewSettings(BaseSettings):
    """Realtime model choices and the Rails boundary, read from the process environment."""

    live_interview_model: str = "gpt-realtime-2.1-mini"
    # Captions of what the candidate says; the same model the turn-based live captions use.
    live_interview_transcription_model: str = LIVE_TRANSCRIPTION_MODEL
    interview_rails_origin: str = "http://api:3000"
    interview_service_secret: str = ""
