"""Screen a frozen owned snapshot and return a proposal; Rails accepts it separately.

Library facts are screened together through `screen_records_sync`, skipping fields Rails
already approved. New checks of library rows are returned as `record_screening` receipts;
Rails saves them only when they match both this frozen snapshot and the live value.
Saved-resume copies are screened but never reported. Any rejected fact fails the whole
request rather than letting uncited or unscreened material into the prompt.
"""
import json

from pydantic import ValidationError
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

from agents.summary_generation_agent import generate_summary
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.summary_generation import render_summary_sources
from privacy.contact_mask import mask_outbound
from schemas.summary_generation import SummaryGenerationInput
from screening.record_adapters import summary_source_records
from screening.records import record_failure_message, screen_records_sync
from screening.session import bind_screened_prompt, within_screening_session
from text_limits import MAX_PROMPT_TEXT
from worker.queue_messages import AiResultMessage


@within_screening_session
def handle_summary_generation_task(task, dependencies):
    usage = []
    def failed(message):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=message, usage=usage)
    try:
        # Compact JSON like Rails, so a snapshot Rails accepted is not rejected here.
        if len(json.dumps(_without_record_ids(task.input), ensure_ascii=False, separators=(",", ":")).encode()) > 180_000:
            return failed("This career evidence is too large to summarize. Reduce its text and try again.")
        snapshot = SummaryGenerationInput.model_validate(task.input)
    except ValidationError:
        return failed("This summary request is invalid. Start a new request.")
    sources = [source for source in snapshot.sources if source.text.strip()]
    if not sources:
        return failed("Add career information before generating a summary.")
    # Measure the actual outbound rendering, including labels, data-block delimiters,
    # and expanded privacy placeholders, before incurring any classifier charges.
    if len(_masked_rendering(sources)) > MAX_PROMPT_TEXT:
        return failed("This career evidence is too long to summarize. Shorten it and try again.")
    try:
        records = summary_source_records(sources)
    except ValueError:
        return failed("This summary request is invalid. Start a new request.")
    outcome = screen_records_sync(records, approved_sources=[source.text for source in sources])
    usage.extend(outcome.decision.model_usages)
    if not outcome.allowed:
        if outcome.decision.too_long:
            return failed("This career evidence is too long to screen. Shorten it and try again.")
        if outcome.decision.unchecked:
            return failed("Screening is unavailable. Try again later.")
        return failed(record_failure_message(outcome))
    settings = dependencies.settings
    labels = [source.label for source in sources]
    prompt = bind_screened_prompt([source.text for source in sources], lambda values: render_summary_sources(labels, values))
    try:
        with capture_run_messages() as messages:
            run = generate_summary(prompt, labels, settings)
    except UnexpectedModelBehavior:
        by_model = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(message.model_name or settings.library_edit_model, settings.library_edit_model)
                by_model.setdefault(model, RunUsage()).incr(message.usage)
        usage.extend(build_model_usage(model, tokens) for model, tokens in by_model.items())
        return failed("The AI could not produce a valid summary. Try again.")
    model = reported_model_name(run.response.model_name or settings.library_edit_model, settings.library_edit_model)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result=run.output.model_dump(),
        usage=[*usage, build_model_usage(model, run.usage)])


def _without_record_ids(task_input):
    """Measure the size cap as Rails does: record ids are bookkeeping, not career text."""
    if not isinstance(task_input, dict) or not isinstance(task_input.get("sources"), list):
        return task_input
    return {**task_input, "sources": [
        {key: value for key, value in source.items() if key != "record_id"} if isinstance(source, dict) else source
        for source in task_input["sources"]]}


def _masked_rendering(sources):
    """Use the exact renderer and whole-prompt mask that the outbound request uses."""
    return mask_outbound(render_summary_sources([source.label for source in sources],
        [source.text for source in sources]))
