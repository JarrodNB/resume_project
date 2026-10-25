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
- `ProfileSection.tsx` (profile card with Edit), `LibrarySection.tsx` (quiet card with a tone-colored icon, a
  count and an Add button; each starts collapsed and stays that way until opened),
  `LibraryEntry.tsx` (ruled entry with an `actions` slot) — display pieces
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

- Certifications have a distinct section with name, issuer, issue/expiry dates, credential ID/URL, and description.
- `CertificationSection.tsx` and `CertificationFormDialog.tsx` provide certification display and CRUD; section id is `library.certifications`.

- `certificationDateValues.ts` restores partial certification dates from API precision metadata and normalizes edits with year/month/day precision.

## AI section review

- `LibraryWorkspace` shares review state and panel selection across the page. Selection
  stores target identity; `libraryReviewTargets` derives current source text and revisions
  from the latest library data. `LibraryAiWorkspace` edits one selected detail in a right
  dock above 899px; its idle state gives a short selection instruction. At 899px and below,
  selecting a detail opens a full-screen modal dialog.
- `LibraryDetail` keeps saved text and compact grades in the record and highlights the
  selected source. Selecting a detail opens its remembered section and focuses the workspace
  heading without scrolling the page. Closing also restores focus without scrolling.
  Mobile exposes saved text in a disclosure.
- `LibrarySectionReview` runs review from the original section and shows progress and errors
  there. The shared workspace is for individual editing; it has no overview list or section picker.
- `useLibraryReview` owns explicit section review, saved assessments, freshness refetches, and
  live task progress. `LibraryAssessment` shows text-labeled red/yellow/green or neutral
  stale/unreviewed state. Up to three current enrichment questions appear together beside the assessed detail
  and in the selected workspace; stale questions are hidden.
- Summary, Experience, Projects, and Facts each have independent explicit review actions.
  Review/edit targets are summary, role descriptions/highlights, project descriptions, and fact
  responses; other sections and profile contact fields are not sent as context. Highlight moves
  refresh assessments after saving, because the optimistic
  library change may be visible before persistence.
- `LibraryEditControl` selects an individual edit in the shared AI workspace;
  `LibraryEditPanel` renders it there. `useLibraryEdit` owns loading, queued
  turns, questions/skip, revision feedback, acceptance/discard and subscription recovery.
  Closing clears selection, keeps server-owned drafts, and returns focus to the source opener
  if it remains in the page; discarding closes the draft server-side. Accepted targets can start again.

- Review questions expose an Answer review question(s) action that selects the same workspace
  in review mode. `ReviewAnswerForm` shows every question with an optional field and one submit
  action; at least one trimmed answer is required. Original zero-based indices are preserved when
  blank fields are omitted. `LibraryEditPanel` submits through the explicit review-answer mutation;
  `useLibraryEdit` never routes a new review answer through an unrelated previous edit.
  Matching saved review-origin tasks restore queued/proposal state after reload; failed
  generations offer Retry revision as a linked turn. All answers remain editable on
  mutation errors. Failed batch retries reuse their saved pairs without inventing new feedback. Accept/discard refetch assessments; stale questions cannot submit.
