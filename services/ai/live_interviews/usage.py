"""Turn a live interview's running provider usage into the priced deltas each heartbeat reports.

LiveKit's `AgentSession.usage` keeps running totals per model: the realtime model's tokens
(`LLMModelUsage`, with audio, text and cached-read splits) and its separately billed input
transcription (`STTModelUsage`, audio seconds). The runner keeps the totals Rails last
acknowledged; a heartbeat reports only what is new since then. Each delta is priced here from
the AI service's price table, so Rails stores a known cost. Anything without a known price (image
tokens, an unexpected model, token-billed transcription) is reported without a cost, which keeps
it unknown on the ledger instead of free. No text ever passes through here, only counts.
"""

import math
from dataclasses import dataclass, fields
from decimal import ROUND_CEILING, Decimal

from livekit.agents.metrics import LLMModelUsage, STTModelUsage

from interviews.live_transcription import MICRODOLLARS_PER_MINUTE
from llm.model_prices import RealtimeUsage, estimate_realtime_cost_microdollars


@dataclass(frozen=True)
class LiveUsageTotals:
    """Running usage counts of one live session; cached counts are included in input counts."""

    realtime_model: str = ""
    transcription_model: str = ""
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    text_input_tokens: int = 0
    cached_text_input_tokens: int = 0
    audio_input_tokens: int = 0
    cached_audio_input_tokens: int = 0
    text_output_tokens: int = 0
    audio_output_tokens: int = 0
    unpriced_tokens: int = 0  # realtime tokens with no known price (images, another model)
    transcription_seconds: float = 0.0
    transcription_input_tokens: int = 0  # token-billed transcription has no known price
    transcription_output_tokens: int = 0

    @classmethod
    def from_model_usage(cls, model_usage: list, *, realtime_model: str, transcription_model: str) -> "LiveUsageTotals":
        """Sum `AgentSession.usage.model_usage`; any other LLM model counts as unpriced realtime use."""
        counts = {field.name: 0 for field in fields(cls) if field.name not in ("realtime_model", "transcription_model")}
        counts["transcription_seconds"] = 0.0
        for usage in model_usage:
            if isinstance(usage, LLMModelUsage):
                counts["input_tokens"] += usage.input_tokens
                counts["cached_input_tokens"] += usage.input_cached_tokens
                counts["output_tokens"] += usage.output_tokens
                if usage.model != realtime_model:
                    counts["unpriced_tokens"] += usage.input_tokens + usage.output_tokens
                    continue
                counts["text_input_tokens"] += usage.input_text_tokens
                counts["cached_text_input_tokens"] += usage.input_cached_text_tokens
                counts["audio_input_tokens"] += usage.input_audio_tokens
                counts["cached_audio_input_tokens"] += usage.input_cached_audio_tokens
                counts["text_output_tokens"] += usage.output_text_tokens
                counts["audio_output_tokens"] += usage.output_audio_tokens
                counts["unpriced_tokens"] += usage.input_image_tokens
            elif isinstance(usage, STTModelUsage) and usage.model == transcription_model:
                counts["transcription_seconds"] += usage.audio_duration
                counts["transcription_input_tokens"] += usage.input_tokens
                counts["transcription_output_tokens"] += usage.output_tokens
        return cls(realtime_model=realtime_model, transcription_model=transcription_model, **counts)

    def minus(self, earlier: "LiveUsageTotals") -> "LiveUsageTotals":
        """The usage added since `earlier` (the totals Rails last acknowledged)."""
        return LiveUsageTotals(realtime_model=self.realtime_model, transcription_model=self.transcription_model, **{
            field.name: getattr(self, field.name) - getattr(earlier, field.name)
            for field in fields(self) if field.name not in ("realtime_model", "transcription_model")})

    def _realtime_cost(self) -> int | None:
        if self.unpriced_tokens:
            return None
        try:
            return estimate_realtime_cost_microdollars(f"openai:{self.realtime_model}", RealtimeUsage(
                text_input_tokens=self.text_input_tokens - self.cached_text_input_tokens,
                cached_text_input_tokens=self.cached_text_input_tokens,
                audio_input_tokens=self.audio_input_tokens - self.cached_audio_input_tokens,
                cached_audio_input_tokens=self.cached_audio_input_tokens,
                text_output_tokens=self.text_output_tokens, audio_output_tokens=self.audio_output_tokens))
        except (KeyError, ValueError):
            return None

    def _transcription_cost(self) -> int | None:
        if self.transcription_input_tokens or self.transcription_output_tokens:
            return None
        seconds = Decimal(str(self.transcription_seconds))
        return int((seconds * MICRODOLLARS_PER_MINUTE / 60).to_integral_value(rounding=ROUND_CEILING))

    def cost_microdollars(self) -> int:
        """The known part of the cost, for the trace (unknown parts add nothing)."""
        return (self._realtime_cost() or 0) + (self._transcription_cost() or 0)


def heartbeat_usage(current: LiveUsageTotals, acknowledged: LiveUsageTotals) -> list[dict]:
    """The heartbeat's `usage` list: one priced delta per model that used anything new."""
    delta = current.minus(acknowledged)
    entries = []
    if delta.input_tokens or delta.output_tokens:
        entry = {"model": current.realtime_model, "input_tokens": delta.input_tokens,
                 "cached_input_tokens": delta.cached_input_tokens, "output_tokens": delta.output_tokens}
        cost = delta._realtime_cost()
        if cost is not None:
            entry["cost_microdollars"] = cost
        entries.append(entry)
    if delta.transcription_seconds > 0 or delta.transcription_input_tokens or delta.transcription_output_tokens:
        entry = {"model": current.transcription_model}
        if delta.transcription_seconds > 0:
            entry["audio_milliseconds"] = math.ceil(delta.transcription_seconds * 1000)
        if delta.transcription_input_tokens or delta.transcription_output_tokens:
            entry |= {"input_tokens": delta.transcription_input_tokens, "output_tokens": delta.transcription_output_tokens}
        cost = delta._transcription_cost()
        if cost is not None:
            entry["cost_microdollars"] = cost
        entries.append(entry)
    return entries
