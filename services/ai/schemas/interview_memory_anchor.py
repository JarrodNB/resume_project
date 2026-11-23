"""Sentence-aligned recall cues, kept separate from the user's original answer."""
from pydantic import BaseModel, Field


class MemoryCue(BaseModel):
    sentence: str = Field(min_length=1, description="One complete original answer sentence, copied exactly, including any section label.")
    cue: str = Field(min_length=1, description="That sentence compressed to its key words, preserving its facts and role.")


class InterviewMemoryAnchor(BaseModel):
    cues: list[MemoryCue] = Field(min_length=1)

    @property
    def text(self) -> str:
        return " → ".join(cue.cue.strip() for cue in self.cues)
