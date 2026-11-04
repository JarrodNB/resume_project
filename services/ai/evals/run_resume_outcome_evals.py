"""Ask whether our resume features make a person's resume better, not just well-formed.

For realistic synthetic applicants this runs the production handlers end to end and compares:
generic (their library as-is), tailored (gap analysis then tailoring), rerun (the same thing
again), gap_answered (they answer gap questions first), reviewed (library review, answers,
then Improve, then tailoring), and responsibilities (an experiment giving the writer the job's
responsibilities, which production leaves out). Blind judges score each version and compare pairs
in both orders; a fact checker compares claims with what that version was allowed to know.
Controls check the judges: identical resumes should tie, and planted lies should be caught.

Limits: judges are models, not recruiters, and the applicant is an ideal answerer. These results
rank versions of a resume. They do not measure callbacks or hiring.
Run: docker compose run --rm ai-worker python -m evals.run_resume_outcome_evals --artifact-dir /tmp/out
After a writer change, --compare-with reruns only the tailored versions on a saved run's gap analysis
and answers, then asks a recruiter judge and a writing judge whether the new resumes beat the saved ones.
This calls paid providers. Use --cases to run a subset. Each case runs one step at a time because model
clients cannot be shared between event loops; run separate processes per case for speed, then --summarize.
"""

import argparse
import asyncio
import hashlib
import json
import math
import threading
import time
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_evals import Dataset
from pydantic_evals.evaluators import Evaluator, EvaluatorContext

from agents.gap_analysis_agent import analyze_gaps
from database.tailoring_sources import TailoringSources
from evals.resume_outcome_evaluators import (
    OutcomeCase,
    OutcomeLabels,
    bullet_overlap,
    generic_resume_sections,
    measure_resume,
    prose_items,
    render_job,
    render_library,
    render_resume,
    weak_phrases,
)
from evals.telemetry import evaluate_dataset, record_average_scores
from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from model_inputs.blocks import source_block
from prompts.resume_outcome_judge_instructions import (
    APPLICANT_INSTRUCTIONS,
    GROUNDEDNESS_JUDGE_INSTRUCTIONS,
    PAIRWISE_JUDGE_INSTRUCTIONS,
    RESUME_OUTCOME_JUDGE_PROMPT_VERSION,
    SHORTLIST_JUDGE_INSTRUCTIONS,
    WRITING_JUDGE_INSTRUCTIONS,
)
from prompts.resume_tailoring_instructions import RESUME_TAILORING_PROMPT_VERSION
from schemas.gap_analysis_context import CareerLibrary
from schemas.gap_response import GapResponseSnapshot
from schemas.library_edit import LibraryEditInput, LibraryEditTurn
from schemas.library_review import LibraryReviewInput
from worker.library_edit_handler import handle_library_edit_task
from worker.library_review_handler import handle_library_review_task
from worker.queue_messages import AiTaskMessage
from worker.settings import load_settings
from worker.tailor_resume_handler import handle_tailor_resume_task
from worker.task_dependencies import TaskDependencies

DATASET_PATH = Path(__file__).parent / "datasets" / "resume_outcome_cases.yaml"
NOT_COVERED = "NOT_COVERED"
PLANTED_LIES = (
    "Led a team of 45 engineers and doubled annual revenue to $90M.",
    "Holds an active PMP certification and a PhD from Stanford University.",
    "Managed the company's Oracle Fusion rollout across 12 countries.",
)
ARMS_VERSUS_TAILORED = ("rerun", "gap_answered", "reviewed", "responsibilities")


class ShortlistScore(BaseModel):
    relevance: int = Field(ge=1, le=5)
    evidence: int = Field(ge=1, le=5)
    credibility: int = Field(ge=1, le=5)
    clarity: int = Field(ge=1, le=5)
    shortlist: int = Field(ge=1, le=5)
    biggest_weakness: str


class PairwiseChoice(BaseModel):
    reason: str
    winner: Literal["A", "B", "tie"]


class ItemVerdict(BaseModel):
    item: int = Field(description="The resume item number.")
    verdict: Literal["supported", "stretched", "fabricated"]
    reason: str = ""


class GroundednessVerdicts(BaseModel):
    verdicts: list[ItemVerdict]


# Judges share one cached HTTP client, which must stay on one open event loop. Production
# handlers open and close their own loops, so judge calls wait on this long-lived one instead.
_JUDGE_LOOP = asyncio.new_event_loop()
threading.Thread(target=_JUDGE_LOOP.run_forever, daemon=True).start()


def run_on_judge_loop(coroutine):
    return asyncio.run_coroutine_threadsafe(coroutine, _JUDGE_LOOP).result()


@dataclass(frozen=True)
class Judges:
    """Eval-only model roles, kept on one model so scores are comparable across arms."""

    shortlist: Agent
    pairwise: Agent
    groundedness: Agent
    applicant: Agent
    writing: Agent


def build_judges(model: str) -> Judges:
    def agent(name, output_type, instructions):
        return Agent(model, name=name, output_type=output_type, instructions=instructions, retries=2,
                     model_settings={"timeout": 180})

    return Judges(
        agent("resume_outcome_shortlist_judge", ShortlistScore, SHORTLIST_JUDGE_INSTRUCTIONS),
        agent("resume_outcome_pairwise_judge", PairwiseChoice, PAIRWISE_JUDGE_INSTRUCTIONS),
        agent("resume_outcome_groundedness_judge", GroundednessVerdicts, GROUNDEDNESS_JUDGE_INSTRUCTIONS),
        agent("resume_outcome_applicant", str, APPLICANT_INSTRUCTIONS),
        agent("resume_outcome_writing_judge", PairwiseChoice, WRITING_JUDGE_INSTRUCTIONS),
    )


async def judge_shortlist(judges: Judges, job: str, resume: str) -> dict:
    prompt = source_block("job", job) + "\n\n" + source_block("resume", resume)
    return (await judges.shortlist.run(prompt)).output.model_dump()


async def judge_pair(judges: Judges, job: str, first: str, second: str, judge: Agent | None = None) -> dict:
    """First's preference from 0 to 1, averaged over both orders so position cannot decide."""
    judge = judge or judges.pairwise

    async def choose(resume_a, resume_b):
        prompt = "\n\n".join([source_block("job", job), source_block("resume_a", resume_a), source_block("resume_b", resume_b)])
        return (await judge.run(prompt)).output

    forward, backward = await asyncio.gather(choose(first, second), choose(second, first))
    value = ({"A": 1.0, "tie": 0.5, "B": 0.0}[forward.winner] + {"B": 1.0, "tie": 0.5, "A": 0.0}[backward.winner]) / 2
    return {"value": value, "reasons": [forward.reason, backward.reason]}


async def judge_groundedness(judges: Judges, truth: str, items: list[str]) -> dict:
    """Share of supported items, with stretched and fabricated claims listed for reading."""
    if not items:
        return {"supported_share": None, "stretched": [], "fabricated": []}
    numbered = "\n".join(f"{number}. {item}" for number, item in enumerate(items, 1))
    prompt = source_block("applicant_records", truth) + "\n\n" + source_block("resume_items", numbered)
    verdicts = (await judges.groundedness.run(prompt)).output.verdicts
    def text(row):
        return items[row.item - 1] if 0 < row.item <= len(items) else ""
    rows = [{"item": text(row), "reason": row.reason, "verdict": row.verdict} for row in verdicts]
    return {
        "supported_share": sum(row["verdict"] == "supported" for row in rows) / max(len(rows), 1),
        "stretched": [row for row in rows if row["verdict"] == "stretched"],
        "fabricated": [row for row in rows if row["verdict"] == "fabricated"],
    }


def answer_questions(judges: Judges, notes: str, questions: list[str]) -> list[str | None]:
    """Answer a batch together, one answer per question and in the same order."""
    async def answer_all():
        return await asyncio.gather(*[answer_as_applicant(judges, notes, question) for question in questions])

    return run_on_judge_loop(answer_all()) if questions else []


async def answer_as_applicant(judges: Judges, notes: str, question: str) -> str | None:
    """An honest, ideal applicant. None means the notes have nothing to add."""
    prompt = source_block("private_notes", notes) + "\n\n" + source_block("question", question)
    answer = (await judges.applicant.run(prompt)).output.strip()
    return None if NOT_COVERED in answer else answer


def edit_target_label(role, record_id: str) -> str:
    """The label production gives this field within its role: description first, then highlights."""
    fields = [*([role.id] if role.description else []), *(item.id for item in role.highlights)]
    return f"T{fields.index(record_id) + 1}"


class ResumePipeline:
    """Runs the same handlers the worker runs, with synthetic sources instead of Postgres."""

    def __init__(self, settings, judges: Judges):
        self.settings, self.judges = settings, judges
        self.dependencies = TaskDependencies(settings, None, None, lambda *_: None)

    def analyze_gaps(self, case: OutcomeCase) -> dict:
        settings = self.settings
        prompt = build_gap_analysis_prompt(case.context, datetime.now(UTC).date())
        run = analyze_gaps(prompt, model=settings.gap_analysis_model, thinking=settings.gap_analysis_thinking,
                           timeout_seconds=settings.llm_run_timeout_seconds,
                           fallback_model=settings.generative_fallback_model)
        return attach_evidence_text(run.gap_analysis, prompt).model_dump(mode="json")

    def tailor(self, context, full_name, gap_analysis, gap_responses=()) -> dict:
        sources = TailoringSources(context, {"full_name": full_name, "links": []}, gap_analysis, list(gap_responses))
        dependencies = replace(self.dependencies, read_gap_analysis_context=lambda *_: context,
                               read_tailoring_sources=lambda *_: sources)
        started = time.monotonic()
        result = handle_tailor_resume_task(AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume",
                                                         input={"job_id": str(uuid4())}), dependencies)
        if result.status != "completed":
            raise RuntimeError(result.error_message or "Tailoring failed")
        costs = [row.cost_microdollars for row in result.usage]
        return {**result.result, "seconds": time.monotonic() - started,
                "cost_microdollars": None if None in costs else sum(costs)}

    def answer_gaps(self, gap_analysis: dict, notes: str) -> list[GapResponseSnapshot]:
        """Answer what the comparison flagged, the way a person uses the gap form."""
        rows = [row for row in gap_analysis.get("assessments", []) if row["verdict"] in {"missing", "partial"}]
        answers = answer_questions(self.judges, notes, [
            f"Do you have any experience with this job requirement? {row['requirement']}" for row in rows])
        return [GapResponseSnapshot(id=str(uuid4()), requirement=row["requirement"], body=answer)
                for row, answer in zip(rows, answers, strict=True) if answer]

    def review_library(self, library: CareerLibrary, notes: str) -> tuple[CareerLibrary, dict]:
        """Review the experience section, answer its questions, and accept each Improve proposal."""
        section = CareerLibrary(experiences=library.experiences)
        targets = []
        for role in section.experiences:
            digest = hashlib.sha256(role.model_dump_json().encode()).hexdigest()
            if role.description:
                targets.append({"kind": "experience", "record_id": role.id, "field": "description", "source_digest": digest})
            for item in role.highlights:
                targets.append({"kind": "experience_highlight", "record_id": item.id, "field": "content", "source_digest": digest})
        for number, target in enumerate(targets, 1):
            target["label"] = f"T{number}"
        source = LibraryReviewInput(section="experience", library=section, targets=targets)
        review = handle_library_review_task(AiTaskMessage(
            ai_task_id=uuid4(), user_id=uuid4(), task_type="review_library_section",
            input={"command_version": 1, "section": "experience", "targets": targets},
        ), replace(self.dependencies, read_library_review=lambda *_: source))
        if review.status != "completed":
            raise RuntimeError(review.error_message or "Review failed")
        assessments = review.result["assessments"]
        edits = [self._improve_field(section, item, notes) for item in assessments]
        replaced = {edit["record_id"]: edit for edit in edits if edit.get("text")}
        improved = library.model_copy(deep=True)
        for role in improved.experiences:
            if role.id in replaced:
                role.description = replaced[role.id]["text"]
            for item in role.highlights:
                if item.id in replaced:
                    item.content = replaced[item.id]["text"]
        return improved, {
            "colors": [item["color"] for item in assessments],
            "questions": sum(len(item.get("questions") or []) for item in assessments),
            "answered": sum(edit["answered"] for edit in edits),
            "improved": len(replaced),
            "after_colors": [edit["color"] for edit in edits if edit.get("color")],
            "qa": [line for edit in edits for line in edit["qa"]],
            "edits": [{"before": edit["before"], "after": edit["text"], "color": edit["color"]}
                      for edit in edits if edit.get("text")],
        }

    def _improve_field(self, section: CareerLibrary, assessment: dict, notes: str) -> dict:
        questions = assessment.get("questions") or []
        answers = [{"question_index": index, "question": question, "answer": answer}
                   for index, (question, answer) in enumerate(zip(questions, answer_questions(self.judges, notes, questions), strict=True))
                   if answer]
        record_id = assessment["record_id"]
        before = next((role.description if assessment["kind"] == "experience" else item.content)
                      for role in section.experiences for item in [*role.highlights, None]
                      if (role.id == record_id and assessment["kind"] == "experience")
                      or (item is not None and item.id == record_id))
        outcome = {"record_id": record_id, "answered": len(answers), "text": None, "color": None, "before": before,
                   "qa": [f"Question: {row['question']}\nAnswer: {row['answer']}" for row in answers]}
        if not answers:
            return outcome
        role = next(role for role in section.experiences if role.id == record_id
                    or any(item.id == record_id for item in role.highlights))
        target = {"kind": assessment["kind"], "record_id": record_id, "field": assessment["field"],
                  "label": edit_target_label(role, record_id),
                  "source_digest": hashlib.sha256(before.encode()).hexdigest()}
        task_id, user_id = uuid4(), uuid4()
        source = LibraryEditInput.model_validate({
            "section": "experience", "library": CareerLibrary(experiences=[role]), "target": target, "feedback": "", "turns": [], "turn": 1,
            "review_question": {"review_task_id": str(uuid4()), "answers": answers}})
        contexts = {task_id: source}
        dependencies = replace(self.dependencies, read_library_edit=lambda task: contexts[task.ai_task_id])
        command = {"command_version": 1, "root_id": str(task_id), "turn": 1, "feedback": ""}
        result = handle_library_edit_task(AiTaskMessage(ai_task_id=task_id, user_id=user_id,
            task_type="improve_library_entry", input=command), dependencies)
        if result.status == "needs_user_input":
            # Follow the product: answer once, or skip when the notes have nothing more.
            question = result.pending_questions[0]
            reply = answer_questions(self.judges, notes, [question["question"]])[0]
            if reply:
                outcome["qa"].append(f"Question: {question['question']}\nAnswer: {reply}")
            child_id = uuid4()
            contexts[child_id] = source.model_copy(update={
                "turns": [LibraryEditTurn(feedback="", history=result.message_history)],
                "previous_task_id": str(task_id), "question_id": question["id"],
                "feedback": reply or "I don't have more detail.", "turn": 2})
            result = handle_library_edit_task(AiTaskMessage(ai_task_id=child_id, user_id=user_id,
                task_type="improve_library_entry", input={**command, "previous_task_id": str(task_id),
                "question_id": question["id"], "feedback": reply or "I don't have more detail.", "turn": 2}), dependencies)
        if result.status == "completed":
            outcome.update(text=result.result["text"], color=result.result.get("color"))
        return outcome


async def evaluate_arm(judges, case, labels, sections, truth, job_text) -> dict:
    """Every per-version score for one resume, named identically across arms."""
    resume = render_resume(sections)
    shortlist, grounded = await asyncio.gather(judge_shortlist(judges, job_text, resume),
                                               judge_groundedness(judges, truth, prose_items(sections)))
    return {
        "resume": resume,
        "metrics": measure_resume(sections, truth=truth, library=case.library, job=case.job, labels=labels),
        "shortlist": shortlist,
        "groundedness": grounded,
    }


def run_case(pipeline: ResumePipeline, judges: Judges, case: OutcomeCase, labels: OutcomeLabels) -> dict:
    """Build every arm for one applicant, then score and compare them."""
    job_text = render_job(case.job)
    truth = render_library(case.library)
    gap_analysis = pipeline.analyze_gaps(case)

    def tailored():
        return pipeline.tailor(case.context, case.full_name, gap_analysis)

    def gap_answered():
        responses = pipeline.answer_gaps(gap_analysis, labels.notes)
        result = pipeline.tailor(case.context, case.full_name, gap_analysis, responses)
        extra = "\n".join(f"{row.requirement}: {row.body}" for row in responses)
        return result, truth + "\n\nThe applicant also stated:\n" + extra, [row.model_dump() for row in responses]

    def reviewed():
        library, review = pipeline.review_library(case.library, labels.notes)
        result = pipeline.tailor(case.context.model_copy(update={"career_library": library}), case.full_name, gap_analysis)
        return result, truth + "\n\nThe applicant also stated:\n" + "\n".join(review["qa"]), review

    def responsibilities():
        job = case.job.model_copy(update={"requirements": [*case.job.requirements, *case.job.responsibilities]})
        return pipeline.tailor(case.context.model_copy(update={"job": job}), case.full_name, gap_analysis)

    built = {name: build() for name, build in (
        ("tailored", tailored), ("rerun", tailored), ("gap_answered", gap_answered),
        ("reviewed", reviewed), ("responsibilities", responsibilities))}

    drafts = {
        "generic": (generic_resume_sections(case), truth, {}),
        "tailored": (built["tailored"]["sections"], truth, {"warnings": built["tailored"]["warnings"]}),
        "rerun": (built["rerun"]["sections"], truth, {}),
        "responsibilities": (built["responsibilities"]["sections"], truth, {}),
        "gap_answered": (built["gap_answered"][0]["sections"], built["gap_answered"][1], {"gap_responses": built["gap_answered"][2]}),
        "reviewed": (built["reviewed"][0]["sections"], built["reviewed"][1], {"review": built["reviewed"][2]}),
    }
    pairs = [("tailored", "generic"), *[(arm, "tailored") for arm in ARMS_VERSUS_TAILORED], ("generic", "generic")]
    planted = list(PLANTED_LIES) + prose_items(drafts["tailored"][0])

    async def judge_everything():
        scored = await asyncio.gather(*[evaluate_arm(judges, case, labels, row[0], row[1], job_text) for row in drafts.values()])
        scored = dict(zip(drafts, scored, strict=True))
        resumes = {name: arm["resume"] for name, arm in scored.items()}
        preferences = await asyncio.gather(*[judge_pair(judges, job_text, resumes[first], resumes[second]) for first, second in pairs])
        return scored, preferences, await judge_groundedness(judges, truth, planted)

    scored, preferences, control = run_on_judge_loop(judge_everything())
    for name, (_, _, extra) in drafts.items():
        scored[name].update(extra)
    caught = sum(row["item"] in PLANTED_LIES for row in control["fabricated"] + control["stretched"])
    return {
        "job": job_text,
        "library": truth,
        "gap_analysis": gap_analysis,
        "arms": scored,
        "preference": {f"{first}_over_{second}": row["value"] for (first, second), row in zip(pairs, preferences, strict=True)},
        "preference_reasons": {f"{first}_over_{second}": row["reasons"] for (first, second), row in zip(pairs, preferences, strict=True)},
        "rerun_overlap": bullet_overlap(drafts["tailored"][0], drafts["rerun"][0]),
        "planted_lies_caught": caught / len(PLANTED_LIES),
    }


@dataclass
class OutcomeScores(Evaluator[OutcomeCase, dict, OutcomeLabels]):
    """Publish the numbers that a report or Logfire can average across cases."""

    def evaluate(self, ctx: EvaluatorContext[OutcomeCase, dict, OutcomeLabels]) -> dict[str, float]:
        output = ctx.output
        scores = {key: value for key, value in output["preference"].items()}
        scores["planted_lies_caught"] = output["planted_lies_caught"]
        for name, arm in output["arms"].items():
            scores[f"{name}_shortlist"] = float(arm["shortlist"]["shortlist"])
            if arm["groundedness"]["supported_share"] is not None:
                scores[f"{name}_supported"] = arm["groundedness"]["supported_share"]
        return scores


def compare_with_saved_run(pipeline: ResumePipeline, judges: Judges, case: OutcomeCase, labels: OutcomeLabels, saved: dict) -> dict:
    """Write new tailored versions from a saved run's inputs and compare them with its saved resumes."""
    job_text, truth = render_job(case.job), render_library(case.library)
    answers = saved["arms"]["gap_answered"]["gap_responses"]
    answered_truth = truth + "\n\nThe applicant also stated:\n" + "\n".join(f"{row['requirement']}: {row['body']}" for row in answers)
    built = {
        "tailored": (pipeline.tailor(case.context, case.full_name, saved["gap_analysis"]), truth),
        "gap_answered": (pipeline.tailor(case.context, case.full_name, saved["gap_analysis"],
                                         [GapResponseSnapshot(**row) for row in answers]), answered_truth),
    }
    generic = saved["arms"]["generic"]["resume"]

    async def judge_everything():
        names = list(built)
        scored = await asyncio.gather(*[evaluate_arm(judges, case, labels, built[name][0]["sections"], built[name][1], job_text)
                                        for name in names])
        scored = dict(zip(names, scored, strict=True))
        jobs = {f"{name}_recruiter": judge_pair(judges, job_text, scored[name]["resume"], saved["arms"][name]["resume"]) for name in names}
        jobs |= {f"{name}_writing": judge_pair(judges, job_text, scored[name]["resume"], saved["arms"][name]["resume"], judges.writing)
                 for name in names}
        jobs["tailored_over_generic"] = judge_pair(judges, job_text, scored["tailored"]["resume"], generic)
        return scored, dict(zip(jobs, await asyncio.gather(*jobs.values()), strict=True))

    scored, preferences = run_on_judge_loop(judge_everything())
    for name, (result, _) in built.items():
        scored[name].update(seconds=result["seconds"], cost_microdollars=result["cost_microdollars"])
    return {
        "arms": scored,
        "saved_arms": {name: saved["arms"][name] for name in built},
        "preference": {key: row["value"] for key, row in preferences.items()},
        "preference_reasons": {key: row["reasons"] for key, row in preferences.items()},
    }


def summarize_comparison(results: dict[str, dict]) -> str:
    """New versus saved: who won, and whether honesty and evidence held."""
    lines = [f"Cases: {len(results)}", "", "| comparison | mean preference | wins | losses | ties | sign test p |", "|---|---|---|---|---|---|"]
    for key in next(iter(results.values()))["preference"]:
        values = [row["preference"][key] for row in results.values()]
        wins, losses, ties, p_value = sign_test(values)
        lines.append(f"| {key} | {_fmt(_mean(values))} | {wins} | {losses} | {ties} | {p_value:.3f} |")
    columns = (("shortlist", lambda a: a["shortlist"]["shortlist"]), ("evidence", lambda a: a["shortlist"]["evidence"]),
               ("credible", lambda a: a["shortlist"]["credibility"]), ("clarity", lambda a: a["shortlist"]["clarity"]),
               ("supported", lambda a: a["groundedness"]["supported_share"]),
               ("stretched", lambda a: len(a["groundedness"]["stretched"])),
               ("fabricated", lambda a: len(a["groundedness"]["fabricated"])),
               ("traps", lambda a: len(a["metrics"]["false_claim_terms"])),
               ("new_nums", lambda a: len(a["metrics"]["invented_numbers"])),
               ("coverage", lambda a: a["metrics"]["requirement_coverage"]),
               ("results_kept", lambda a: a["metrics"]["result_retention"]),
               ("words", lambda a: a["metrics"]["words"]), ("bullets", lambda a: a["metrics"]["bullets"]),
               ("verbatim", lambda a: a["metrics"]["verbatim_share"]),
               ("weak_phrases", lambda a: len(weak_phrases(a["resume"]))),
               ("writer_seconds", lambda a: a.get("seconds")),
               ("writer_cost_cents", lambda a: a["cost_microdollars"] / 10_000 if a.get("cost_microdollars") is not None else None))
    lines += ["", "| version | " + " | ".join(name for name, _ in columns) + " |", "|---|" + "---|" * len(columns)]
    for group, label in (("saved_arms", "saved"), ("arms", "new")):
        for arm in ("tailored", "gap_answered"):
            cells = [_fmt(_mean(read(row[group][arm]) for row in results.values())) for _, read in columns]
            lines.append(f"| {label} {arm} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def run_comparison(saved_dir: str, artifact_dir: str, names: list[str] | None = None) -> None:
    """Compare chosen cases with a saved run. Provider failures stop the case, as they should."""
    saved = {}
    for path in Path(saved_dir).rglob("resume_outcome_results.json"):
        saved.update(json.loads(path.read_text()))
    settings = load_settings()
    judges = build_judges(settings.eval_judge_model)
    pipeline = ResumePipeline(settings, judges)
    results = {case.name: compare_with_saved_run(pipeline, judges, case.inputs, case.metadata, saved[case.name])
               for case in load_dataset(names).cases}
    path = Path(artifact_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / "resume_comparison_results.json").write_text(json.dumps(results, indent=2, default=str))
    print(summarize_comparison(results))


def load_dataset(names: list[str] | None = None) -> Dataset[OutcomeCase, dict, OutcomeLabels]:
    dataset = Dataset[OutcomeCase, dict, OutcomeLabels].from_file(DATASET_PATH, custom_evaluator_types=[OutcomeScores])
    if names:
        dataset.cases = [case for case in dataset.cases if case.name in names]
    dataset.add_evaluator(OutcomeScores())
    return dataset


def sign_test(values: list[float]) -> tuple[int, int, int, float]:
    """Wins, losses, ties, and a two-sided exact p-value that ignores ties."""
    wins, losses = sum(v > 0.5 for v in values), sum(v < 0.5 for v in values)
    total = wins + losses
    tail = sum(math.comb(total, k) for k in range(min(wins, losses) + 1)) / (2 ** total) if total else 1.0
    return wins, losses, len(values) - total, min(1.0, 2 * tail)


def _mean(values) -> float | None:
    values = [value for value in values if value is not None]
    return sum(values) / len(values) if values else None


def _fmt(value) -> str:
    return "n/a" if value is None else f"{value:.2f}"


def summarize(results: dict[str, dict]) -> str:
    """A readable table of each arm and comparison across cases."""
    arms = ("generic", "tailored", "rerun", "responsibilities", "gap_answered", "reviewed")
    columns = (("shortlist", lambda a: a["shortlist"]["shortlist"]), ("relevance", lambda a: a["shortlist"]["relevance"]),
               ("evidence", lambda a: a["shortlist"]["evidence"]), ("credible", lambda a: a["shortlist"]["credibility"]),
               ("clarity", lambda a: a["shortlist"]["clarity"]),
               ("supported", lambda a: a["groundedness"]["supported_share"]),
               ("stretched", lambda a: len(a["groundedness"]["stretched"])),
               ("fabricated", lambda a: len(a["groundedness"]["fabricated"])),
               ("traps", lambda a: len(a["metrics"]["false_claim_terms"])),
               ("new_nums", lambda a: len(a["metrics"]["invented_numbers"])),
               ("coverage", lambda a: a["metrics"]["requirement_coverage"]),
               ("results_kept", lambda a: a["metrics"]["result_retention"]),
               ("hidden", lambda a: a["metrics"]["hidden_fact_recall"]),
               ("chrono", lambda a: float(a["metrics"]["chronological"])),
               ("words", lambda a: a["metrics"]["words"]), ("bullets", lambda a: a["metrics"]["bullets"]),
               ("verbatim", lambda a: a["metrics"]["verbatim_share"]))
    lines = [f"Cases: {len(results)}", "", "| arm | " + " | ".join(name for name, _ in columns) + " |",
             "|---|" + "---|" * len(columns)]
    for arm in arms:
        cells = [_fmt(_mean(read(row["arms"][arm]) for row in results.values())) for _, read in columns]
        lines.append(f"| {arm} | " + " | ".join(cells) + " |")
    lines += ["", "| comparison | mean preference | wins | losses | ties | sign test p |", "|---|---|---|---|---|---|"]
    for key in next(iter(results.values()))["preference"]:
        values = [row["preference"][key] for row in results.values()]
        wins, losses, ties, p_value = sign_test(values)
        lines.append(f"| {key} | {_fmt(_mean(values))} | {wins} | {losses} | {ties} | {p_value:.3f} |")
    lines += ["", f"Planted lies caught: {_fmt(_mean(row['planted_lies_caught'] for row in results.values()))}",
              f"Rerun prose overlap: {_fmt(_mean(row['rerun_overlap'] for row in results.values()))}"]
    return "\n".join(lines)


def run_resume_outcome_evals(artifact_dir: str | None = None, names: list[str] | None = None):
    """Run every arm for the chosen cases, report averages, and save outputs for reading."""
    settings = load_settings()
    judges = build_judges(settings.eval_judge_model)
    pipeline = ResumePipeline(settings, judges)
    cases = load_dataset(names).cases
    by_person = {case.inputs.full_name: case for case in cases}
    results: dict[str, dict] = {}

    def task(case: OutcomeCase) -> dict:
        named = by_person[case.full_name]
        results[named.name] = run_case(pipeline, judges, case, named.metadata)
        return results[named.name]

    def score_report(report):
        """Skip averages when every case failed, so the failures below still print."""
        if report.averages() is not None:
            record_average_scores(report)

    report = evaluate_dataset(
        lambda: load_dataset(names), task, name="evals.resume_outcome",
        metadata={"model": settings.resume_tailoring_model, "judge_model": settings.eval_judge_model,
                  "prompt_version": RESUME_TAILORING_PROMPT_VERSION, "judge_version": RESUME_OUTCOME_JUDGE_PROMPT_VERSION},
        version=RESUME_TAILORING_PROMPT_VERSION, tags=["eval", "resume_outcome"],
        max_concurrency=1, score_report=score_report,
    )
    summary = summarize(results) if results else "No completed cases."
    print(summary)
    for failure in report.failures:
        print(f"FAILED {failure.name}: {failure.error_message}")
    if artifact_dir:
        path = Path(artifact_dir)
        path.mkdir(parents=True, exist_ok=True)
        (path / "resume_outcome_results.json").write_text(json.dumps(results, indent=2, default=str))
        (path / "resume_outcome_summary.md").write_text(summary)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact-dir", help="Save full outputs and a summary here")
    parser.add_argument("--cases", nargs="*", help="Run only these case names")
    parser.add_argument("--summarize", help="Print one summary from saved results below this folder, with no model calls")
    parser.add_argument("--compare-with", help="Folder of a saved full run to compare new tailored versions against")
    parser.add_argument("--summarize-comparison", help="Print one summary from saved comparisons below this folder")
    options = parser.parse_args()
    if options.summarize_comparison:
        saved = {}
        for path in Path(options.summarize_comparison).rglob("resume_comparison_results.json"):
            saved.update(json.loads(path.read_text()))
        print(summarize_comparison(saved))
    elif options.compare_with:
        run_comparison(options.compare_with, options.artifact_dir, options.cases)
    elif options.summarize:
        saved = {}
        for path in Path(options.summarize).rglob("resume_outcome_results.json"):
            saved.update(json.loads(path.read_text()))
        print(summarize(saved))
        strong = {name: row for name, row in saved.items() if name.startswith("strong_fit")}
        if strong and len(strong) < len(saved):
            print("\nStrong fits only\n" + summarize(strong))
            print("\nStretch fits only\n" + summarize({name: row for name, row in saved.items() if name not in strong}))
    else:
        run_resume_outcome_evals(options.artifact_dir, options.cases)
