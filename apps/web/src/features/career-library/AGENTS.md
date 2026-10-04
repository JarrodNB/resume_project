# AGENTS.md — features/career-library

## Purpose

The career library page (`/library`): the user's profile (contact details, summary),
experiences with highlights, projects, education, and skills. The library is the base that
tailored resumes are built from, so resumes are not listed here. Entries can be deleted, and
experiences, projects, and educations can be merged into a duplicate (editing comes later).

## Contents

- `CareerLibraryPage.tsx` — page; `ProfileSection.tsx`, `LibrarySection.tsx`, `LibraryEntry.tsx`
  (optional `actions` slot), `SkillList.tsx` (chips with delete) — display pieces
- `LibraryEntryActions.tsx` — "…" menu per entry; `DeleteEntryDialog.tsx`, `MergeEntryDialog.tsx`
  (pick another entry in the same section) — confirmation dialogs
- `libraryEntryLabels.ts` — entry labels for menus and dialogs (with dates, so look-alike
  duplicates can be told apart)
- `careerLibraryOperations.ts` — one query for the whole library (profile via `me`);
  `useCareerLibrary.ts` — hook (`cache-and-network`, so a fresh import shows up)
- `careerLibraryMutations.ts` — delete and merge mutations; `useLibraryEntryActions.ts` — runs
  them for one entry kind and refetches the library
- `importSummary.ts` — reads `import_summary` from an AiTask result and from navigation state;
  `ImportSummaryNotice.tsx` — "N added, M merged" notice after an import
- `groupSkillsByCategory.ts` — skill grouping helper
- `*.test.ts(x)` — page, actions (merge and delete), and grouping tests

## Local Rules

- After an import, `ParsedResumeReview` navigates here with `{ importSummary }` in router state.
