# AGENTS.md — features/gap-analysis

## Purpose

Gap analysis on the job workspace's Fit tab: compare one saved job with the user's career library
(`analyzeJobGaps`, followed live with `aiTaskUpdated`) and show each requirement's verdict with
the library entries cited as evidence. The user can add details to a gap or partial match in the
same view (`saveGapResponse`) or dismiss it; a saved answer stays visible if a later run marks the
requirement met. These details are source material for the resume writer, so prompts and examples
should ask for what the user did, where, and the result.
Adding it to the career library creates a career context entry, listed on the career library page.

## Contents

- `GapAnalysisCard.tsx` — the comparison on the Fit tab: run button, live progress, failure with
  retry, completed result (waiting line with stage captions while running, a brief notice when a watched run finishes; Compare is disabled with an "Add description" action when the job has no description), using shared lifecycle state from the job workspace
- `GapAnalysisResultView.tsx` — summary panel (one or two sentences, count chips, hint, run button), then the groups from `groupAssessments.ts`: Gaps to fill,
  Could be stronger, Answered, Met, Nice to have, Dismissed
- `RequirementAssessmentItem.tsx` — `VerdictBadge` and the row for each group. Gaps, partial
  matches and answered rows are always open. Met and nice-to-have rows start collapsed
  (`job.<id>.gap.<requirement>`), and their form stays mounted so unsaved text survives closing them
- `GapResponseForm.tsx` / `useSaveGapResponse.ts` — details for the resume writer on one requirement
- `useSetGapDismissal.ts` — dismisses or restores a requirement (`setGapDismissal`)
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
  so they stay when the comparison is run again. Dismissals (`Job.dismissedRequirements`) match the
  same way, only shape this tab, and lose to a "met" verdict.
- Answering or dismissing moves a row between groups. It never changes the AI's verdict.
- Evidence text is copied from the library by the AI service; display it as-is. Leave out
  `kind: summary` evidence: that text is the whole profile summary, and showing it under a
  requirement repeats the biography.
