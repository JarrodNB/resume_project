# Gap-analysis verification

Measured on 2026-10-18 using synthetic library content only. Original source is the planning
base `25d45c5911f3eaf2b4ff3079ab18e73a6544a00b`; production candidate is
`a9b3a320aa08a59420f5f8b69a71ebbb61b127a6`.

## Screening work

`measure_screening.py` runs the handler with the real shared screening/chunking path, a
provider classifier that approves each chunk after a scripted 5 ms delay, and a TestModel
generator. Network was disabled. Both revisions use the same script and fixture builders.
Each count includes the separate job screen, then all library screens.

| Fixture (added skills) | Before calls | After calls | After chunk lengths | Before total s | After total s |
| --- | ---: | ---: | --- | ---: | ---: |
| Small (12, width 10) | 19 | 2 | 141; 1,225 | 2.4150 | 3.1419 |
| Many short (80, width 10) | 87 | 3 | 141; 4,000; 1,265 | 0.7478 | 0.0735 |
| Multi-chunk (80, width 100) | 87 | 5 | 141; 4,000; 4,000; 4,000; 1,065 | 0.7605 | 0.0952 |

Serialization includes JSON structure; after assembly even many short entries exceed one
4,000-character chunk. Successive library chunks overlap by 300 characters, so their lengths
sum to more than the assembled source. The first 141-character chunk is always the projected
job. The original 163-character job also included the empty responsibilities field. Old library calls screen
entries separately. The after small library fits one call as intended.

Scripted classifier delay totals drop from 0.095/0.435/0.435 seconds to
0.010/0.015/0.025 seconds. These are injected delays, not measured provider latency. Total
wall times include startup, lazy initialization, preparation, validation, and fake generation;
the first fixture is dominated by startup and is slower after. Do not infer production
speed from these fake-delay totals. Raw results: `synthetic-before.json`, `synthetic-after.json`.

## One live observation

`measure_live.py` uses the same base library plus 12 added skills (no repeated `x` text),
real configured screening/generation providers, fake storage/context, and no database. Both
runs completed with `openai:gpt-6-luna`, low thinking, and Jev screening.

| Measurement | Before | After |
| --- | ---: | ---: |
| Screening calls | 19 | 2 |
| Screening time | 91.3248 s | 7.8518 s |
| Generation time | 15.2098 s | 12.8476 s |
| Generation requests | 1 | 1 |
| Total handler time | 106.6419 s | 20.7258 s |
| Estimated provider cost | $0.000692 | $0.000271 |

One observed generation request means no output-validation retry in either run. Provider SDK
internal transport retries are not separately instrumented; screening count is wrapper calls,
not a claim about transport attempts. Estimated costs come from existing task usage accounting.
These sequential observations are not a controlled latency benchmark, percentile estimate, or
speed guarantee. Provider load, token differences from qualification projection, and model
variability affect time. The after measurement ran while the gap quality evaluation was also
running. Raw results are `live-before.json` and `live-after.json`.

## Reproduce

From either checkout, mount its AI source into the existing development image. Run the same
saved scripts against each revision; the scripts depend on repository synthetic test helpers.

```bash
docker run --rm --network none -e OPENAI_API_KEY=dummy -e TYPESAFE_API_KEY=dummy \
  -e PYTHONPATH=/app -v "$PWD/services/ai:/app" \
  -v "$PWD/docs/plans/gap-analysis-requirements-only/verification:/verification" \
  -w /app resume_project-ai:latest python /verification/measure_screening.py

docker run --rm --env-file services/ai/.env -e PYTHONPATH=/app \
  -v "$PWD/services/ai:/app" \
  -v "$PWD/docs/plans/gap-analysis-requirements-only/verification:/verification" \
  -w /app resume_project-ai:latest python /verification/measure_live.py

docker run --rm --env-file services/ai/.env -e PYTHONPATH=/app \
  -v "$PWD/services/ai:/app" \
  -v "$PWD/docs/plans/gap-analysis-requirements-only/verification:/verification" \
  -w /app resume_project-ai:latest python -m evals.run_report gap_analysis \
  --output-dir /verification
```

The live commands incur provider charges and require configured credentials. Source mounted
read/write follows the repository's development container convention; the scripts do not edit
production source. No browser automation was used.

## Regression and documentation review

Ticket 01/02 checks supplied by the coordinator already passed: 542 offline AI tests (nine DB
tests deselected), 89 focused integration checks, 20 Rails specs, 12 frontend tests, frontend
typecheck/lint, and changed-file AI Ruff. They were not repeated for these reporting-only
artifacts. Full Ruff has four reproduced pre-existing conversation-logging findings.

Inspected `docs/architecture/career-library.md` and `services/ai/gap_analysis/AGENTS.md`:
qualification-only inputs, complete-library failure behavior, the 80,000-character assembled
source and 120,000-character prompt caps, and preparation ownership/interface are documented.
No additional production or technical-guide edits were needed. Human manual QA and acceptance
remain with the coordinator; reporting does not establish human completion.

## Paid quality evaluation

`python -m evals.run_report gap_analysis --output-dir /verification` exited 0. Nine cases
completed with zero task/evaluator failures; configured Luna/low, prompt version 4. Full
configuration, per-case outputs, evaluator scores, and cost coverage are in
[the generated report](gap_analysis-20261018T063827Z-bc436868a5ca40d7aeaa7e8540e37621.md).
Coverage, evidence validity, evidence recall, and gap recall averaged 1.0. Verdict accuracy
and met agreement averaged 0.9444. This is not a perfect quality result:

- `strong_match`: Python tenure from June 2018 to the fixed October 2026 eval date was wrongly
  described as about four years and four months, yielding partial instead of expected met.
- `synonyms_and_equivalent_degree`: “Strong JS skills” was marked partial because JavaScript
  was listed without demonstrated strength; the fixture expects met.

Both outputs preserve valid evidence and qualification coverage. The original-source
comparison below found the same verdict mismatches. No model/prompt fixes were included
in this verification ticket. There were nine captured Jev
and nine captured Luna requests; per-case two requests include screening plus generation,
not two generation requests. Known estimated cost subtotal was $0.002014, marked incomplete
because configured fallback instrumentation can omit failed intermediate attempts. This
runner evaluates prompt generation, validation, and evidence attachment; it does not exercise
the worker's whole-library preparation and is not a screening latency benchmark.

### Original quality comparison

After the final run, ran the same report CLI on original source (prompt version 3), preserving
[the baseline report](gap_analysis-20261018T064013Z-12a1f338e8b248ec9221c6bbddbaaa08.md).
It exited 1: eight cases completed, while `adjacent_skills_are_partial` failed with
`InputBlocked: Input safety screening is unavailable. Please try again later.` This is an
external screening failure, not a successful safety decision. The original dataset differs
only by lacking the responsibility added to `strong_match`; qualification labels are the same.

The eight completed original cases scored coverage/evidence validity/evidence recall/gap
recall 1.0, verdict accuracy/met agreement 0.9375. They contain the same two qualification
verdict mismatches as the final run. Original `strong_match` correctly recognizes over five
years but still calls Python partial because it doubts continuous Python use; final output's
incorrect four-year explanation is a distinct model reasoning error. Both runs mark strong
JavaScript partial. These single runs show existing verdict instability, not evidence of a
new deterministic regression. Different completed-case denominators prevent treating the
aggregate difference as an improvement. Baseline known cost subtotal $0.001776 is incomplete
(including unavailable screening usage and fallback coverage). No further prompt/model scope
was added to this ticket. The final candidate's complete nine-case quality result remains
imperfect and should be disclosed in human QA.

Retried only `adjacent_skills_are_partial` once using `retry_original_adjacent.py`, which
filters the original dataset loader then invokes the unchanged report CLI and runner.
The separate [retry report](gap_analysis-20261018T064142Z-dd1d642fb67d44648c4e802cc1d36011.md)
records exit 0, zero failures, and 1.0 for every score. All nine original cases therefore
have completed observations across the initial run plus this retry, with the same two
verdict mismatches as the final nine-case run. The initial outage remains recorded; this
combined observation is not a single clean baseline run or evidence of a quality gain.
