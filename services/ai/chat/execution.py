"""Run one guarded career-chat turn on the shared execution supervisor.

Rails owns accepted dialogue and all writes. Streaming is provisional and optional;
Redis failure never restarts provider work or substitutes for canonical acceptance.
"""
import asyncio
import hashlib
from datetime import UTC, datetime

import logfire
from pydantic_ai import Agent
from pydantic_ai.exceptions import (
    FallbackExceptionGroup,
    ModelAPIError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    UserPromptPart,
)
from pydantic_ai.models.fallback import FallbackModel
from pydantic_ai.usage import RunUsage, UsageLimits

from agents.chat_agent import make_chat_agent
from agents.chat_summary_agent import make_chat_summary_agent
from agents.user_text_fallback_agent import screen_fallback_message_async, user_text_fallback_agent
from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
from interviews.client import RailsTransportError
from mcp_tools.client import ToolServerConnection
from model_inputs.blocks import source_block
from model_inputs.chat import render_chat_summary, render_chat_summary_context
from pii import PiiDetectionError, PiiRestorationError
from privacy.contact_mask import contact_scope, import_privacy_scope, mask_outbound
from privacy.known_contact import KnownContact
from prompts.chat_instructions import CHAT_INSTRUCTIONS, CHAT_PROMPT_VERSION
from prompts.chat_summary_instructions import CHAT_SUMMARY_INSTRUCTIONS, CHAT_SUMMARY_PROMPT_VERSION
from screening.conversation import ScreenedConversationTurn, screen_conversation_turn
from screening.screen_user_text import screen_user_text_async
from screening.session import screening_session
from settings import load_settings
from telemetry.privacy import telemetry_scope
from telemetry.tracing import flush_tracing, record_prompt_version
from text_limits import MAX_PROMPT_TEXT


class ChatRejected(RuntimeError):
    pass


class ChatExecutionAdapter:
    stream_output = True

    def __init__(self, client, models, *, model=None, fallback_model=None, tool_server=None):
        self.client, self.models = client, models
        settings = load_settings()
        # The separate MCP tool server (ai-mcp); a missing token secret fails startup loudly.
        self.tool_server = tool_server or ToolServerConnection.from_environment(settings)
        self.model = model or settings.chat_model
        self.fallback_model = fallback_model or settings.generative_fallback_model
        if any(value not in {"openai:gpt-6-luna", "openai:gpt-5-nano"}
               for value in (self.model, self.fallback_model)):
            raise ValueError("Chat models must be openai:gpt-6-luna or openai:gpt-5-nano")

    async def claim(self, operation_id):
        return await self.client.claim(operation_id)

    async def heartbeat(self, claim):
        return await self.client.heartbeat(claim)

    async def _screen(self, claim, text):
        decision = await self._screen_decision(claim, text)
        if not decision.allowed:
            raise ChatRejected("context_limit" if decision.too_long else
                               "screening_unavailable" if decision.unchecked else "screening_blocked")

    async def _screen_decision(self, claim, text):
        """Screen text on this claim's accounted models and return the decision."""
        async def primary(chunk, model, timeout):
            with user_text_screen_agent.override(model=self.models.accounted(self.client, claim, "screening", model)):
                return await screen_user_message_async(chunk, model, timeout)

        async def fallback(chunk, model, timeout):
            with user_text_fallback_agent.override(model=self.models.accounted(self.client, claim, "screening", model)):
                return await screen_fallback_message_async(chunk, model, timeout)

        return await screen_user_text_async(text, "typesafe:jev-1.13.0", 30,
            classify=primary, classify_fallback=fallback, _fallback_model="openai:gpt-5-nano")

    async def execute(self, claim, output):
        # Bound local detection too; oversized source text never reaches expensive NLP.
        source_characters = sum(len(m.content) for m in claim.payload.messages) + len(claim.payload.message) + len(claim.payload.summary.text)
        early = claim.payload.summary_plan and not claim.payload.summary_plan.scheduled
        minimum = [message for message in claim.payload.messages
                   if not early or message.position > claim.payload.summary_plan.through_position]
        minimum_characters = sum(len(message.content) for message in minimum) + len(claim.payload.message)
        if not early:
            minimum_characters += len(claim.payload.summary.text)
        if source_characters > 200_000 or minimum_characters > MAX_PROMPT_TEXT:
            await self.client.fail(claim, "context_limit", False)
            await self.client.usage(claim, [], incomplete=False)
            if output:
                await output.emit("failed")
            return
        contact = KnownContact.from_values(**claim.payload.contact.model_dump())
        with (contact_scope(contact), import_privacy_scope() as privacy,
              telemetry_scope(chat_operation_id=claim.operation_id, user_id=claim.payload.user_id),
              logfire.span("chat.operation"), record_prompt_version(CHAT_PROMPT_VERSION)):
            try:
                remaining = (claim.execution_deadline - datetime.now(UTC)).total_seconds()
                async with asyncio.timeout(max(0, remaining)):
                    # Keep the same privacy object on spans before detection completes.
                    await asyncio.to_thread(privacy.prepare, "\n\n".join(
                        [claim.payload.summary.text] + [m.content for m in claim.payload.messages] + [claim.payload.message]))
                    await self._turn(claim, output, privacy)
            except ChatRejected as error:
                await self.client.fail(claim, str(error), False)
                if output:
                    await output.emit("failed")
            except (UnexpectedModelBehavior, UsageLimitExceeded, PiiDetectionError, PiiRestorationError):
                await self.client.fail(claim, "execution_failed", False)
                if output:
                    await output.emit("failed")
            except (ModelAPIError, FallbackExceptionGroup):
                await self.client.fail(claim, "dependency_unavailable", True)
                if output:
                    await output.emit("failed")
            except TimeoutError:
                await self.client.fail(claim, "execution_timeout", True)
                if output:
                    await output.emit("failed")
            except asyncio.CancelledError:
                if output:
                    await output.emit("cancelled")
                raise
            finally:
                # Per-request markers carry charges; the execution marker carries none.
                await self.client.usage(claim, [], incomplete=False)
                flush_tracing()

    def _model(self, claim, stage):
        model = self.models.accounted(self.client, claim, stage, self.model)
        if self.fallback_model != self.model:
            model = FallbackModel(model, self.models.accounted(self.client, claim, stage, self.fallback_model))
        return model

    async def _summarize(self, claim, privacy, usage):
        payload = claim.payload
        plan = payload.summary_plan
        prefix = [message.model_copy(update={"content": mask_outbound(message.content)})
                  for message in payload.messages if message.position <= plan.through_position]
        prompt = render_chat_summary(mask_outbound(payload.summary.text), prefix)
        if len(prompt) + len(CHAT_SUMMARY_INSTRUCTIONS) > MAX_PROMPT_TEXT:
            raise ChatRejected("context_limit")
        # Only server-owned accepted sources enter this exact guard. No new user
        # material is included: the new message has its own prior screening pass.
        guard = ScreenedConversationTurn(prompt).guard
        with record_prompt_version(CHAT_SUMMARY_PROMPT_VERSION):
            result = await make_chat_summary_agent(guard).run(prompt, model=self._model(claim, "summary"),
                model_settings={"thinking": False, "max_tokens": 2400}, usage=usage,
                usage_limits=UsageLimits(request_limit=8, tool_calls_limit=0, total_tokens_limit=128000))
        summary = privacy.restore(result.output)
        if not summary.strip() or len(summary) > 8000:
            raise ChatRejected("execution_failed")
        return {"text": summary, "expected_version": payload.summary.version,
                "through_position": plan.through_position}

    async def _turn(self, claim, output, privacy):
        payload = claim.payload
        usage = RunUsage()
        with screening_session(120):
            turn = await screen_conversation_turn(payload.message,
                screen=lambda text: self._screen(claim, text),
                render=lambda text: source_block("user_message", text))
            summary_update = None
            summary = payload.summary.text
            messages = payload.messages
            if payload.summary_plan and not payload.summary_plan.scheduled:
                summary_update = await self._summarize(claim, privacy, usage)
                summary = summary_update["text"]
                messages = [message for message in messages
                            if message.position > summary_update["through_position"]]
            history = []
            rendered_characters = len(CHAT_INSTRUCTIONS) + len(turn.prompt)
            if summary:
                rendered = render_chat_summary_context(mask_outbound(summary))
                history.append(ModelRequest(parts=[UserPromptPart(rendered)]))
                rendered_characters += len(rendered)
            for message in messages:
                content = mask_outbound(message.content)
                rendered = source_block("user_message", content) if message.role == "user" else content
                rendered_characters += len(rendered)
                history.append(ModelRequest(parts=[UserPromptPart(rendered)]) if message.role == "user"
                               else ModelResponse(parts=[TextPart(content)]))
            if rendered_characters > MAX_PROMPT_TEXT:
                raise ChatRejected("context_limit")
            reply = await self._reply(claim, output, privacy, turn, history, usage)
            # Normal cadence compacts after the answer so the current model still
            # sees all five preceding complete exchanges. Early pressure compacts
            # before answering and leaves those five exchanges intact instead.
            if payload.summary_plan and payload.summary_plan.scheduled:
                summary_update = await self._summarize(claim, privacy, usage)
            await self._accept(claim, reply, summary_update)
            if output:
                await output.emit("completed")

    async def _reply(self, claim, output, privacy, turn, history, usage):
        # The token names the claim's owner, never a model-chosen user. Tool text is
        # screened here on this claim's accounted screen before the model sees it.
        tools = self.tool_server.toolset(user_id=claim.payload.user_id, operation_id=claim.operation_id,
            expires_at=claim.execution_deadline, screen=lambda text: self._screen_decision(claim, text))
        agent = make_chat_agent(turn.guard, toolsets=[tools])
        if output:
            await output.emit("started")
        published, last_publish = "", 0.0
        # Text from every model response is kept, including a short preamble before a tool
        # call, so the saved reply always matches what observers already saw streamed.
        responses = []
        loop = asyncio.get_running_loop()
        # Each tool round trip is another accounted model request, on top of retries and fallback.
        async with agent.iter(turn.prompt, message_history=history, model=self._model(claim, "reply"),
                model_settings={"thinking": False, "max_tokens": 2400}, usage=usage,
                usage_limits=UsageLimits(request_limit=12, tool_calls_limit=2, total_tokens_limit=128000)) as run:
            async for node in run:
                if not Agent.is_model_request_node(node):
                    continue
                responses.append("")
                async with node.stream(run.ctx) as stream:
                    async for event in stream:
                        text = _text_delta(event)
                        if not text:
                            continue
                        responses[-1] += text
                        combined = _combined_reply(responses)
                        if len(combined) > 8000:
                            raise ChatRejected("execution_failed")
                        if output and loop.time() - last_publish >= 0.05:
                            published = await self._publish(output, privacy, combined, published)
                            last_publish = loop.time()
        reply = privacy.restore(_combined_reply(responses))
        if not reply.strip() or len(reply) > 8000:
            raise ChatRejected("execution_failed")
        if reply.startswith(published) and output:
            await self._deltas(output, reply[len(published):])
        return reply

    async def _publish(self, output, privacy, text, published):
        # Hold incomplete local privacy placeholders until a whole token arrives.
        stable = text
        if stable.rfind("«") > stable.rfind("»"):
            stable = stable[:stable.rfind("«")]
        restored = privacy.restore(stable)
        if not restored.startswith(published):
            return published
        await self._deltas(output, restored[len(published):])
        return restored

    @staticmethod
    async def _deltas(output, text):
        for start in range(0, len(text), 4096):
            await output.emit("delta", text=text[start:start + 4096])

    async def _accept(self, claim, reply, summary_update=None):
        digest = hashlib.sha256(claim.payload.message.encode()).hexdigest()
        try:
            values = {"reply": reply, "screened_message_sha256": digest}
            if summary_update is not None:
                values["summary_update"] = summary_update
            await self.client.accept(claim, **values)
        except RailsTransportError:
            # An ambiguous acceptance must be read back, never regenerated.
            status = await self.client.status(claim.operation_id)
            if status.get("status") != "accepted":
                raise


def _text_delta(event):
    """Return new reply text from a streamed model event, ignoring tool calls and thinking."""
    if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
        return event.part.content
    if isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
        return event.delta.content_delta
    return ""


def _combined_reply(responses):
    """Join text from each model response in the run, skipping responses with none."""
    return "\n\n".join(text for text in responses if text)
