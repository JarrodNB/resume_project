"""Carry a trusted saved-record snapshot separately from model-facing content.

Only database readers and verified server snapshots attach this state. The source binds
an approval to the complete content read with its record version, within this task only.
"""
from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True)
class RecordScreeningState:
    record_type: str
    record_id: str
    observed_updated_at: datetime
    screened_at: datetime | None
    screening_policy_version: str | None
    source: str
