# AGENTS.md — features/gap-analysis

## Purpose

Gap analysis on the job page: compare one saved job with the user's career library
(`analyzeJobGaps`, followed live with `aiTaskUpdated`) and show each requirement's verdict with
the library entries cited as evidence. No questions are asked in this step.

## Contents

- `GapAnalysisCard.tsx` — "How you match" card: run button, live progress, failure with retry,
  completed result; follows the job's `latestGapAnalysis` when it is still queued (works on reload)
- `GapAnalysisResultView.tsx` — summary, verdict counts, "Requirements" and "Nice to have" lists
- `RequirementAssessmentItem.tsx` — `VerdictBadge` and one requirement with its evidence
- `parseGapAnalysisResult.ts` — result types, `VERDICT_LABELS`, and `parseGapAnalysisResult`
  (mirror of `services/ai/schemas/gap_analysis.py` `GapAnalysisResult`)
- `gapAnalysisOperations.ts` — `ANALYZE_JOB_GAPS_MUTATION`; hook `useStartGapAnalysis.ts`
- `*.test.tsx` / `*.test.ts` — card states and the result parser

## Local Rules

- The result lives on the AI task (`Job.latestGapAnalysis`), not on the job. Re-running creates a
  new task; the newest one is shown.
- Evidence text is copied from the library by the AI service; display it as-is.
