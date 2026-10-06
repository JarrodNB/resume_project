# AGENTS.md — features/career-library

## Purpose

The career library page (`/library`): the user's profile (contact details, summary),
experiences with highlights, projects, education, skills, and facts. The library is the base that
tailored resumes are built from, so resumes are not listed here. Experiences, projects, and
educations are listed most recent first (the API orders them by date; they can't be dragged).
Each section can add an entry, and each entry can be edited. Entries can be deleted, and
experiences, projects, and educations can be merged into a duplicate. Delete all empties the
library (entries and the profile an import fills) so a new import starts fresh. Highlights can
be dragged to a new place in their role or into another role; skills can be dragged within
their category.

## Contents

- `CareerLibraryPage.tsx` — page, wrapped in one `DragDropProvider`; `ClearLibraryButton.tsx`
  and `ClearLibraryDialog.tsx` empty the library after confirmation; `useClearCareerLibrary.ts`
  runs `clearCareerLibrary` and refetches
- `ProfileSection.tsx` (profile card with Edit), `LibrarySection.tsx` (tone-colored card with a
  count and an Add button; each starts collapsed and stays that way until opened),
  `LibraryEntry.tsx` (tinted entry with an `actions` slot) — display pieces
- `ExperienceSection.tsx`, `ProjectSection.tsx`, `EducationSection.tsx`, `SkillsSection.tsx`,
  `FactsSection.tsx` — one section each, owning its add/edit dialog
- `ExperienceFormDialog.tsx`, `ProjectFormDialog.tsx`, `EducationFormDialog.tsx`,
  `ProfileFormDialog.tsx`, `SkillFormDialog.tsx`, `FactFormDialog.tsx` — save dialogs
- `EntryFormDialog.tsx` — shared dialog shell; `LibraryField.tsx` — labelled input
- `libraryFormValues.ts` — `blankToNull` and `highlightsToSave` (an unchanged bullet list is
  omitted so highlight ids stay put)
- `HighlightEditor.tsx` — add, edit, remove, and reorder a role's bullets inside the form
- `SortableHighlightList.tsx` — a role's draggable highlights (drop area works when empty)
- `SkillList.tsx` — skill chips grouped by category, draggable within a category, with edit
  and delete
- `FactList.tsx` — facts (a requirement and the user's answer), with edit and delete
- `LibraryEntryActions.tsx` — "…" menu per entry (Edit, Delete, Merge into…);
  `DeleteEntryDialog.tsx`, `MergeEntryDialog.tsx` (pick another entry in the same section)
- `libraryEntryLabels.ts` — entry labels for menus and dialogs (with dates, so look-alike
  duplicates can be told apart)
- `careerLibraryOperations.ts` — one query for the whole library (profile via `me`);
  `useCareerLibrary.ts` — hook (`cache-and-network`, so a fresh import shows up)
- `careerLibraryMutations.ts` — delete, clear-all, and merge mutations; `useLibraryEntryActions.ts`
  — runs delete and merge for one entry kind and refetches the library
- `careerLibrarySaveMutations.ts` — create and update mutations; `useSaveLibraryRecord.ts` —
  runs one and refetches the library, leaving validation errors in the dialog
- `careerLibraryReorderMutations.ts` — `reorderSkills` and `moveExperienceHighlight`;
  `useLibraryReordering.ts` — runs them, writing the change to the Apollo cache first and
  refetching (with an error) if the server rejects it
- `useLibraryDragHandlers.ts` — the page's drag handlers: skill drops are saved on drop;
  highlights follow the pointer across roles during the drag (`highlightsOf`) and are saved on
  drop
- `importSummary.ts` — reads `import_summary` from an AiTask result and from navigation state;
  `ImportSummaryNotice.tsx` — "N added, M merged" notice after an import. It hides after a few
  seconds or when dismissed, and the navigation state is cleared so a refresh does not show it again
- `groupSkillsByCategory.ts` — skill grouping helper (also defines the skill order sent when
  skills are reordered)
- `*.test.ts(x)` — page, actions (add, edit, merge, delete, and delete all), highlight saving, and grouping tests

## Local Rules

- After an import, `ParsedResumeReview` navigates here with `{ importSummary }` in router state.
  The notice copies that into its own state and drops it from the browser history entry, so a
  refresh does not show it again.
- `reorderSkills` needs every skill id, so skill drops send the whole skill list in display
  order (categories as `groupSkillsByCategory` shows them).
- Don't sort roles, projects, or education on the client; the API's order is the display order.
- Edit forms send every field, so a cleared optional field is stored as null. An experience
  update omits `highlights` when the bullets are unchanged.
- Section ids are `library.profile`, `library.experience`, `library.projects`, `library.education`,
  `library.skills`, and `library.facts`. A collapsed section's entries are not in the page, so
  they are not drag targets.
