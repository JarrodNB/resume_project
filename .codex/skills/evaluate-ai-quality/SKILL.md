---
name: evaluate-ai-quality
description: Investigate Careergrind AI output quality, extend synthetic evaluation cases, or compare prompts and models using existing eval runners. Use for quality evidence and interpretation, not ordinary unit-test runs or production task recovery.
---

# Evaluate AI quality

Turn a quality question into a bounded experiment with interpretable evidence. Follow
applicable `AGENTS.md` files and [execution environment guidance](../cloud-runtime.md).
Read [eval guidance](../../../services/ai/evals/AGENTS.md) for the relevant suite and
[testing guidance](../../../docs/testing.md) for offline versus paid checks.

## Define the question and cases

- State the behavior being measured and the failure that would matter to the user.
  Translate vague complaints into examples, such as repeated question intent, unsupported
  personal claims, omitted evidence, or inaccurate requirement verdicts.
- Reuse the relevant dataset and production agent entry point. Inspect the runner to learn
  what it actually exercises: some suites include production screening; others use trusted
  synthetic inputs and leave worker behavior to offline tests. Do not claim broader coverage.
- Add the smallest useful set of synthetic or anonymized cases covering the failure and
  legitimate neighboring behavior. Do not copy real resumes or private task transcripts
  into datasets or reports. Preserve the dataset's schema and labeling conventions.
- Keep expected answers, allowed scores, and evaluator-only metadata out of generation
  inputs. Judges may receive their rubric and source inputs, but must not receive the
  expected verdict as an answer hint.
- Use deterministic evaluators for structure, exact sources, labels, and decision checks;
  reserve judges for subjective quality. Test evaluator failures as well as successes offline.
  Do not relax labels or scoring just to improve a candidate's score.

## Choose a controlled run

- Use existing `run_*_evals.py` runners; avoid a parallel generation pipeline. Consult
  [report CLI guidance](../../../docs/evals/README.md) and the current
  [suite registry](../../../services/ai/evals/run_report.py) before selecting report options.
  Standalone suites may exist without report-CLI support.
- Keep cases, screening, judge configuration, reasoning settings, dimensions, and limits
  fixed when comparing a single variable. Record checkout/commit and any local diff,
  prompt version, exact models, fallback policy, case selection, and run count.
- The report CLI can compare two supported models with repeated `--model` options;
  explicit generative overrides disable fallback for those eval runs. They do not change
  production defaults. For prompt comparisons, run the same suite on each revision and
  align cases by name. Do not quietly combine a prompt change with a model change.
- Run focused offline evaluator/contract tests first. Paid runs require configured
  credentials and authorization covering the requested providers and scope. Honor existing
  authorization; if absent, prepare the exact command, cases, configuration, and bounded
  run plan before asking for the missing authorization. Do not launch repeated paid tuning
  runs beyond that scope or bypass unavailable screening.
- Print results by default. Save Markdown reports only when requested, using the existing
  `--save` or `--output-dir` options for supported suites. Inspect saved content before
  sharing it. Do not invent unsupported flags or assume every runner writes an artifact.
- Basic/spoken interview preparation and dialogue have a documented first-iteration quality
  exception. Follow their offline contracts and bounded provider-smoke guidance; do not
  introduce paid quality datasets or judges as an incidental part of verification.

## Interpret the evidence

- Separate execution/provider/judge errors from genuine low scores. An outage is not a
  successful injection rejection. Preserve runner exit/failure policies; do not treat an
  all-error run as a quality result or retry silently until it passes.
- Inspect case-level outputs, evaluator reasons, and regressions alongside aggregates.
  A subjective score is a review signal unless the existing suite defines a pass gate.
  Small samples and one stochastic run do not establish broad quality or a reliable winner.
- Attribute conclusions to the path exercised. Agent-only quality does not prove queue
  reliability, worker screening, source persistence, browser behavior, or human acceptance.
- Preserve Logfire eval traces and score reporting. Include screening, generation, judges,
  embeddings, and retries in cost evidence where captured. Distinguish known cost estimates
  from invoices; unknown usage/prices or hidden fallback attempts make totals incomplete.
  Use measured duration for latency claims and disclose concurrent work or configuration
  differences that compromise comparisons.

## Deliver the result

Report the question, revision/configuration, cases and actual commands, execution errors,
case-level findings, score changes, available duration/cost evidence, and limits. Link a
report only if one was requested and produced. Recommend the next change only when the
evidence supports it; use [change-ai-behavior](../change-ai-behavior/SKILL.md) for implementation.
If paid evaluation could not run, report the offline evidence and the unmeasured quality
question explicitly rather than declaring the change validated.
