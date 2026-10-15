"""
Description: Evaluates live Jev through the actual input capability, with a fake generator.
Run: docker compose run --rm ai python -m evals.run_prompt_guardrail_evals
Index:
    - load_prompt_guardrail_dataset: synthetic assembled inputs and expected allow decisions
    - run_prompt_guardrail_evals: reports safety decisions and errors to Logfire
"""

from pathlib import Path

from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from pydantic_ai_harness import InputBlocked, InputGuardrail
from pydantic_evals import Case, Dataset

from agents.resume_parsing_agent import format_resume_user_prompt
from evals.run_resume_parsing_evals import load_resume_parsing_dataset
from evals.telemetry import evaluate_dataset, record_score
from screening.prompt_guardrail import BLOCKED_MESSAGE, screen_prompt
from worker.settings import load_settings


def load_prompt_guardrail_dataset() -> Dataset[str, bool, None]:
    """Includes assembled-context cases and expected rejections from parsing fixtures."""
    dataset = Dataset[str, bool, None].from_file(
        Path(__file__).parent / "datasets" / "prompt_guardrail_cases.yaml"
    )
    for case in load_resume_parsing_dataset().cases:
        if (case.metadata or {}).get("expects_input_block"):
            dataset.cases.append(
                Case(
                    name=case.name,
                    inputs=format_resume_user_prompt(case.inputs),
                    expected_output=False,
                )
            )
    return dataset


def run_prompt_guardrail_evals() -> None:
    """Exercises the production capability and fails on wrong decisions or screening outages."""
    agent = None
    metadata = {}

    def prepare_agent():
        """Build the fake generator after tracing is configured."""
        nonlocal agent
        agent = Agent(TestModel(), capabilities=[InputGuardrail(guard=screen_prompt)])
        metadata["screening_model"] = load_settings().user_text_screen_model

    def check_case(prompt: str) -> bool:
        """Uses live Jev; no generative provider is called, even for allowed cases."""
        try:
            agent.run_sync(prompt)
        except InputBlocked as error:
            # Missing keys, length errors and outages must not score as a detected attack.
            if str(error) != BLOCKED_MESSAGE:
                raise
            return False
        return True

    def score_report(report):
        """Emit only the guardrail decision and task/case-error scores."""
        errors = len(report.failures) + sum(len(case.evaluator_failures) for case in report.cases)
        matched = sum(case.output == case.expected_output for case in report.cases)
        accuracy = matched / len(report.cases) if report.cases else 0.0
        record_score(name="decision_accuracy", value=accuracy)
        record_score(name="case_errors", value=errors)

    report = evaluate_dataset(
        load_prompt_guardrail_dataset, check_case,
        name="evals.prompt_guardrail",
        metadata=metadata,
        max_concurrency=3, prepare=prepare_agent, score_report=score_report,
        print_options={"include_input": False, "include_output": True},
    )
    errors = len(report.failures) + sum(len(case.evaluator_failures) for case in report.cases)
    matched = sum(case.output == case.expected_output for case in report.cases)

    if errors or matched != len(report.cases):
        raise RuntimeError("Prompt guardrail evaluation contained errors or incorrect decisions")


if __name__ == "__main__":
    run_prompt_guardrail_evals()
