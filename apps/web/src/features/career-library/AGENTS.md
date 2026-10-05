# AGENTS.md — features/career-library

## Purpose

The career library page (`/library`): the user's profile (contact details, summary),
experiences with highlights, projects, education, skills, and facts added from gap responses. The library is the base that
tailored resumes are built from, so resumes are not listed here. Experiences, projects, and
educations are listed most recent first (the API orders them by date; they can't be dragged).
Entries can be deleted, and experiences, projects, and educations can be merged into a
duplicate (editing comes later). Highlights can be dragged to a new place in their role or into
another role; skills can be dragged within their category.

## Contents

- `CareerLibraryPage.tsx` — page, wrapped in one `DragDropProvider`
- `ProfileSection.tsx`, `LibrarySection.tsx` (tone-colored card with a count), `LibraryEntry.tsx`
  (tinted entry with an `actions` slot) — display pieces
- `SortableHighlightList.tsx` — a role's draggable highlights (drop area works when empty)
- `SkillList.tsx` — skill chips grouped by category, draggable within a category, with delete
- `FactList.tsx` — facts (a requirement and the user's answer), with delete
- `LibraryEntryActions.tsx` — "…" menu per entry; `DeleteEntryDialog.tsx`, `MergeEntryDialog.tsx`
  (pick another entry in the same section) — confirmation dialogs
- `libraryEntryLabels.ts` — entry labels for menus and dialogs (with dates, so look-alike
  duplicates can be told apart)
- `careerLibraryOperations.ts` — one query for the whole library (profile via `me`);
  `useCareerLibrary.ts` — hook (`cache-and-network`, so a fresh import shows up)
- `careerLibraryMutations.ts` — delete and merge mutations; `useLibraryEntryActions.ts` — runs
  them for one entry kind and refetches the library
- `careerLibraryReorderMutations.ts` — `reorderSkills` and `moveExperienceHighlight`;
  `useLibraryReordering.ts` — runs them, writing the change to the Apollo cache first and
  refetching (with an error) if the server rejects it
- `useLibraryDragHandlers.ts` — the page's drag handlers: skill drops are saved on drop;
  highlights follow the pointer across roles during the drag (`highlightsOf`) and are saved on
  drop
- `importSummary.ts` — reads `import_summary` from an AiTask result and from navigation state;
  `ImportSummaryNotice.tsx` — "N added, M merged" notice after an import
- `groupSkillsByCategory.ts` — skill grouping helper (also defines the skill order sent when
  skills are reordered)
- `*.test.ts(x)` — page, actions (merge and delete), and grouping tests

## Local Rules

- After an import, `ParsedResumeReview` navigates here with `{ importSummary }` in router state.
- `reorderSkills` needs every skill id, so skill drops send the whole skill list in display
  order (categories as `groupSkillsByCategory` shows them).
- Don't sort roles, projects, or education on the client; the API's order is the display order.
