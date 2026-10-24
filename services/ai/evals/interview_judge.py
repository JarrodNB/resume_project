"""Score all applicable interview rubrics in one model attempt.

The complete response must be valid before any named score enters the report.
Provider and output failures remain native evaluator errors, without repair calls.
"""

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic_ai import Agent
from pydantic_ai.models import Model, infer_model
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.usage import UsageLimits
from pydantic_evals.evaluators import EvaluationReason, Evaluator

from model_inputs.judge import format_judge_input
from prompts.interview_judge_instructions import INTERVIEW_JUDGE_INSTRUCTIONS


class RubricScore(BaseModel):
    """One bounded score with the explanation needed for human review."""

    model_config = ConfigDict(extra="forbid")
    name: str
    score: float = Field(ge=0, le=1, allow_inf_nan=False, strict=True)
    reason: str = Field(min_length=1)

    @field_validator("reason")
    @classmethod
    def nonblank_reason(cls, value: str) -> str:
        """Reject explanations that contain only whitespace."""
        if not value.strip():
            raise ValueError("Each rubric needs an explanation")
        return value


class InterviewJudgment(BaseModel):
    """A list retains duplicate names so validation cannot silently overwrite scores."""

    model_config = ConfigDict(extra="forbid")
    scores: list[RubricScore]


def single_attempt_model(model: Model | str) -> Model:
    """Disable SDK HTTP retries on a fresh OpenAI client, without changing generation.

    Model resolution preserves the configured OpenAI API style and endpoint. Other
    providers are rejected because their hidden retry policies have not been verified.
    Explicit Model objects are a test seam for offline providers.
    """
    resolved = infer_model(model)
    if isinstance(resolved, (OpenAIChatModel, OpenAIResponsesModel)):
        provider = OpenAIProvider(openai_client=resolved.client.with_options(max_retries=0))
        return type(resolved)(resolved.model_name, provider=provider,
                              profile=resolved.profile, settings=resolved.settings)
    if isinstance(model, str):
        raise TypeError("Interview judges require an OpenAI model")
    return resolved




@dataclass
class InterviewJudge(Evaluator):
    """Hide scope selection, single-attempt execution and complete score validation."""

    rubrics: dict[str, str]
    model: Model | str
    timeout_seconds: float

    async def evaluate(self, ctx):
        """Return every applicable named result together, or raise one evaluator error."""
        rubrics = {name: rubric for name, rubric in self.rubrics.items()
                   if name != "knowledge_accuracy" or ctx.inputs.set_type == "knowledge"}
        agent = Agent(single_attempt_model(self.model), output_type=InterviewJudgment,
                      instructions=INTERVIEW_JUDGE_INSTRUCTIONS, retries=0,
                      model_settings={"timeout": self.timeout_seconds},
                      name="interview_judge")
        prompt = format_judge_input(rubrics, ctx.inputs, ctx.output)
        result = await agent.run(prompt, usage_limits=UsageLimits(request_limit=1))
        scores = result.output.scores
        if len(scores) != len(rubrics) or {score.name for score in scores} != set(rubrics):
            raise ValueError("Judge must return each requested rubric exactly once")
        return {score.name: EvaluationReason(value=score.score, reason=score.reason)
                for score in scores}
