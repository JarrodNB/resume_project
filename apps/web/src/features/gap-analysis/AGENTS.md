# AGENTS.md — features/gap-analysis

## Purpose

Gap analysis on the job page: compare one saved job with the user's career library
(`analyzeJobGaps`, followed live with `aiTaskUpdated`) and show each requirement's verdict with
the library entries cited as evidence. The user can respond to a gap or partial match in the same
view (`saveGapResponse`); a saved answer stays visible if a later run marks the requirement met.
Adding it to the career library creates a library fact, listed on the career library page.

## Contents

- `GapAnalysisCard.tsx` — "How you match" card: run button, live progress, failure with retry,
  completed result, using shared lifecycle state from the job page
- `GapAnalysisResultView.tsx` — summary, verdict counts, "Requirements" and "Nice to have" lists
- `RequirementAssessmentItem.tsx` — `VerdictBadge` and one requirement with its evidence and,
  for a gap or partial match, `GapResponseForm.tsx` (`useSaveGapResponse.ts`). The row starts
  collapsed to the requirement and verdict (`job.<id>.gap.<requirement>`); the form stays
  mounted so an unsaved answer survives collapsing the row
- `savedGapResponse.ts` — the `Job.gapResponses` shape the form matches by requirement text
- `parseGapAnalysisResult.ts` — result types, `VERDICT_LABELS`, and `parseGapAnalysisResult`
  (mirror of `services/ai/schemas/gap_analysis.py` `GapAnalysisResult`); `warnings` on the
  task result (a note left out by the screen) are shown with the summary
- `useGapAnalysis.ts` — owns request, task selection, and subscription state for both the card
  and resume controls. Nonterminal tasks block writing, including after reload or subscription
  errors. Completion or failure releases writing; comparison remains optional.
- `gapAnalysisOperations.ts` — `ANALYZE_JOB_GAPS_MUTATION`; hook `useStartGapAnalysis.ts`
  writes the new task onto the cached job so the page sees it without a reload
- `*.test.tsx` / `*.test.ts` — card states and the result parser

## Local Rules

- The result lives on the AI task (`Job.latestGapAnalysis`), not on the job. Re-running creates a
  new task; the newest one is shown. Responses are matched to requirements by their exact text,
  so they stay when the comparison is run again.
- Evidence text is copied from the library by the AI service; display it as-is. Leave out
  `kind: summary` evidence: that text is the whole profile summary, and showing it under a
  requirement repeats the biography.
