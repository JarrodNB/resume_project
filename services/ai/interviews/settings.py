"""Configure Luna reasoning in the separate spoken interview runtime.

Preparation and dialogue have independent environment settings. False disables
reasoning; named effort levels use the SDK's normal thinking configuration.
"""

from pydantic_ai.settings import ThinkingLevel
from pydantic_settings import BaseSettings


class InterviewThinkingSettings(BaseSettings):
    """Read only spoken interview thinking settings from the process environment."""

    interview_preparation_thinking: ThinkingLevel = False
    interview_dialogue_thinking: ThinkingLevel = False
