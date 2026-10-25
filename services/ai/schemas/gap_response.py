"""A frozen queued answer with saved checks kept outside prompt serialization.

Old tasks may lack an ID. They remain usable, but cannot reuse or persist approvals.
"""

from pydantic import BaseModel, Field


class GapResponseSnapshot(BaseModel):
    id: str | None = Field(default=None, exclude=True)
    requirement: str = ""
    body: str = ""
    screened_fields: list[str] = Field(default_factory=list, exclude=True)
