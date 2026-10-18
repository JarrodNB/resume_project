# Consolidated interview judge live validation

Both suites ran once on 2026-10-18 against commit `cd5ef42`, using synthetic fixtures.
Generation used the configured `openai:gpt-6-luna`; the independent judge was explicitly
set to `openai:gpt-6.1-sol`. Reports retain raw outputs, individual reasons, rubric
metadata, usage, and failure details.

Commands ran from the worker checkout, once with `interview_questions` and once with
`interview_feedback`:

```bash
docker run --rm --env-file /home/jarrod/Desktop/resume_project/services/ai/.env \
  -e EVAL_JUDGE_MODEL=openai:gpt-6.1-sol \
  -v "$PWD/services/ai:/app" -v "$PWD/docs/evals:/docs/evals" \
  -w /app resume_project-ai:latest python -m evals.run_report SUITE
```

| Result | Questions | Feedback |
| --- | --- | --- |
| CLI exit | 0 | 1 |
| Successful generation / total cases | 13 / 13 | 12 / 13 |
| Captured judge requests | 13 | 12 |
| Evaluator failures | 0 | 0 |
| Task failures | 0 | 1 |
| Judge input / output tokens | 11,843 / 4,727 | 12,490 / 4,577 |
| Known USD subtotal | $0.002232, incomplete | $0.002218, incomplete |

Counts match one judge request per generated case and none for failed generation.
The reports expose whole-run provider counts; strict per-case attempt behavior also
has offline provider-boundary regression coverage. Both reports identify attempt
limit 1 and the independent judge model. Every successful case has applicable named
scores and reasons. Feedback knowledge accuracy appears only for the three successful
knowledge cases, all scored 1.0; the other nine successful feedback cases omit it.

Feedback's `knowledge-accurate-answer-with-omission` case failed before generation:
Jev safety screening timed out, and the input guardrail reported screening unavailable.
It has no generated output or judge scores. The saved report and nonzero exit preserve
this external failure. No rerun was made to hide the failure or improve scores.

Question subjective averages: personalization 0.9346, semantic variety 0.9308,
requested scope 0.9423, supported premises 0.9692. Feedback averages: requested scope
0.9917, coaching usefulness 0.9667, example usefulness 0.9208, grounding 1.0,
answer preservation 1.0, knowledge accuracy 1.0. All deterministic averages were 1.0.

Reasons distinguish the rubrics: the general replacement question scored scope 0.25
for focusing on practical work methods; sparse question sets lost variety points for
overlapping themes; unsupported assumptions about interpersonal volunteering and
warehouse discrepancies lowered grounding. Retail feedback's example usefulness was
0.65 because it repeated the answer and appended a prompt instead of demonstrating
the advised process. Knowledge reasons recognized corrections to Python mutability,
nut cross-contact, and historical source reliability. These are review observations,
not new acceptance gates.

Limitations: judge pricing is absent from the local price table, so its costs remain
unknown. Generation fallback is configured and limits accounting for hidden intermediate
attempts. Feedback additionally has missing usage on its failed screening/generation
path. OpenTelemetry warned that dictionary-valued `judge_rubrics` span attributes are
unsupported; this existing warning may omit the span attribute, while both saved report
configurations retain the full rubric dictionary. Remote Logfire UI was not inspected.
Saved artifacts were inspected for synthetic content and common credential/header
patterns before committing; no credentials were found.

Saved reports:

- `interview_questions-20261018T063407Z-11a21ec7d7ea4559972d506fd0b646ee.md`
- `interview_feedback-20261018T063429Z-38bcde0aeea546299e9b7fd114f0f37c.md`
