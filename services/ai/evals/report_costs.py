"""
Description: Estimates report-only provider costs from native per-request usage spans.
Index:
    - ReportCosts: captured calls and conservative USD summaries
    - ReportCostProcessor: associates model calls with native eval cases
"""

import re
from dataclasses import dataclass, field
from threading import Lock

from opentelemetry.sdk.trace import SpanProcessor
from pydantic_ai.usage import RunUsage

from worker.model_prices import MODEL_PRICES, estimate_cost_microdollars


def _priced_model(attributes):
    """Normalizes bare provider model names, preferring the actual response model."""
    provider = attributes.get("gen_ai.provider.name", attributes.get("gen_ai.system", ""))
    requested = str(attributes.get("gen_ai.request.model", "unknown"))
    response = str(attributes.get("gen_ai.response.model", requested))
    candidates = [response, f"{provider}:{response}"]
    # Date-stamped OpenAI snapshots share the configured base model's rate.
    configured = requested if ":" in requested else f"{provider}:{requested}"
    if response == requested or re.fullmatch(re.escape(requested) + r"-\d{4}-\d{2}-\d{2}", response):
        candidates.append(configured)
    return next((model for model in candidates if model in MODEL_PRICES), candidates[1])


@dataclass
class ReportCosts:
    """Retains calls even when validation, the task or an evaluator subsequently fails."""

    calls: list[dict] = field(default_factory=list)
    coverage_issues: list[str] = field(default_factory=list)

    def summary(self, case=None):
        """Returns known subtotal and explicit incompleteness, optionally for one case."""
        calls = [call for call in self.calls if case is None or call["case"] == case]
        models = {}
        for call in calls:
            row = models.setdefault(call["model"], {"model": call["model"], "calls": 0,
                "input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0,
                "known_cost_microdollars": 0, "unknown_calls": 0})
            row["calls"] += 1
            for name in ("input_tokens", "cached_input_tokens", "output_tokens"):
                row[name] += call[name]
            if call["cost_microdollars"] is None:
                row["unknown_calls"] += 1
            else:
                row["known_cost_microdollars"] += call["cost_microdollars"]
        return {"models": list(models.values()), "calls": len(calls),
                "known_cost_microdollars": sum(row["known_cost_microdollars"] for row in models.values()),
                "complete": bool(calls) and not self.coverage_issues
                    and all(call["cost_microdollars"] is not None for call in calls),
                "issues": sorted({call["issue"] for call in calls if call["issue"]}
                                 | set(self.coverage_issues))}


class ReportCostProcessor(SpanProcessor):
    """Collects only this capture's model request spans; ignores aggregate agent spans."""

    def __init__(self, costs, is_active):
        """Stores a capture identity check and thread-safe span ancestry."""
        self.costs = costs
        self.is_active = is_active
        self.cases = {}
        self.lock = Lock()

    def on_start(self, span, parent_context=None):
        """Propagates native case identity across task, guardrail, judge and model spans."""
        if not self.is_active():
            return
        with self.lock:
            parent = span.parent.span_id if span.parent else None
            self.cases[span.context.span_id] = (span.attributes or {}).get(
                "case_name", self.cases.get(parent))

    def on_end(self, span):
        """Records each completed provider request once, without disrupting the call."""
        with self.lock:
            if span.context.span_id not in self.cases:
                return
            case = self.cases.pop(span.context.span_id)
            attributes = span.attributes or {}
            if attributes.get("gen_ai.operation.name") not in {"chat", "embeddings"}:
                return
            provider = attributes.get("gen_ai.provider.name", attributes.get("gen_ai.system"))
            if provider in {"test", "function"}:
                return
            model = _priced_model(attributes)
            input_tokens = attributes.get("gen_ai.usage.input_tokens", 0)
            output_tokens = attributes.get("gen_ai.usage.output_tokens", 0)
            cached = attributes.get("gen_ai.usage.cache_read.input_tokens", 0)
            writes = attributes.get("gen_ai.usage.cache_creation.input_tokens", 0)
            issue = None
            cost = None
            if not input_tokens and not output_tokens:
                issue = "Provider usage unavailable"
            elif model not in MODEL_PRICES:
                issue = f"Price unavailable: {model}"
            elif writes:
                issue = "Cache-write lifetime unavailable in telemetry"
            else:
                try:
                    cost = estimate_cost_microdollars(model, RunUsage(input_tokens=input_tokens,
                        output_tokens=output_tokens, cache_read_tokens=cached))
                except Exception:  # noqa: BLE001 -- reporting must never break provider calls
                    issue = f"Cost estimate unavailable: {model}"
            self.costs.calls.append({"case": case, "model": model, "input_tokens": input_tokens,
                "output_tokens": output_tokens, "cached_input_tokens": cached,
                "cost_microdollars": cost, "issue": issue})

    def shutdown(self):
        """Discards ancestry without removing completed report calls."""
        with self.lock:
            self.cases.clear()

    def force_flush(self, timeout_millis=30000):
        """Reports immediately; no export queue or provider requests exist."""
        return True
