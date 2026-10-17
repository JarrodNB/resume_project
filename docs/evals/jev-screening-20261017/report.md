# Jev single-pass screening verification — 2026-10-17

The production default is 4,000 characters with 300 characters of overlap. Each cohesive
source is screened once per task execution. Later tasks screen reused content again.

## Live chunk comparison

The same 14 synthetic resumes were assessed under each configuration: four benign
documents and ten documents containing explicit instruction attacks. Cases include
ordinary one/two-page-sized extracts, long documents, defensive security work, attacks
near the beginning/middle/end, and attacks spanning both chunk grids.

| Configuration | Missed attacks | False positives | Errors | Jev requests | Mean seconds/document | Estimated USD |
| --- | --- | --- | --- | --- | --- | --- |
| 2,000 / overlap 300 | 0 / 10 | 0 / 4 | 0 | 48 | 4.05 | 0.001906 |
| 4,000 / overlap 300 | 0 / 10 | 0 / 4 | 0 | 25 | 2.40 | 0.001338 |
| Whole resume | 0 / 10 | 0 / 4 | 0 | 14 | 1.44 | 0.001495 |

Full initial evidence is in `chunk-comparison.json`. The 4,000 setting used fewer requests
and less time than 2,000 at equal observed decisions, so it is the selected chunk size.
Whole resumes were faster. This experiment does not show that chunking improves detection.

The sample is small, hand-labelled, synthetic, and uses one attack template. Configurations
run sequentially and stop at the first rejection, so latency and cost depend on attack
position, provider conditions, and caching. These are observations, not detection guarantees.

## Actual checks

- Full offline AI suite after selecting the default: **481 passed, 9 deselected**.
  Database tests were excluded. Requests were blocked and Docker networking disabled.
- Whole-service Ruff: the same four pre-existing findings as the baseline, confined to
  `conversation_logging/__init__.py` and `test_conversation_logging_reliability.py`.
  No new lint findings. Patch whitespace checks pass.
- Live `evals.run_user_text_screen_evals`: exit 0; decision and question match averages 1.00.
- Live `evals.run_prompt_guardrail_evals`: exit 0; all decisions matched, no case errors.
- Both existing live Jev suites repeated with explicit production setting 4,000: exit 0.
- Live resume parsing, pasted job parsing, scraped job extraction/sorting, gap analysis,
  tailoring, interview questions, and interview feedback runners: all exit 0.

## Quality limitations observed

The generative suites are quality signals, not all-perfect assertions. Pasted job extraction
reported requirement precision 0.750; gap analysis verdict accuracy/met agreement 0.963.
Tailoring faithfulness, relevance, and requested omission averages were 1.00. Interview
question structure/evidence averages were 1.00, with supported premises 0.800. Feedback
example usefulness was 0.923 and grounding 0.975; structural checks were 1.00. These
scores are retained as limitations rather than reported as perfect passes or used to
expand this screening change into unrelated prompt tuning.

Interview evaluation logs also contain existing telemetry warnings about dictionary-valued
judge rubric attributes. The runners completed successfully. No browser QA was run.

## Reproduction

Run in the AI Docker container with ignored provider credentials configured:

```bash
python -m evals.run_screen_chunk_comparison --output /app/chunk-comparison.json
python -m evals.run_user_text_screen_evals
python -m evals.run_prompt_guardrail_evals
```

The comparison runner uses the production chunk policy and a whole-input Jev baseline,
keeps errors separate from blocks, writes evidence before a failing exit, and never
adds whole-document screening as a second production pass.
