# AGENTS.md — features/career-library

## Purpose

The career library page (`/library`): the user's profile (contact details, summary),
experiences with highlights, projects, education, skills, and career context entries. The library is the base that
tailored resumes are built from, so resumes are not listed here. Experiences, projects, and
educations are listed most recent first (the API orders them by date; they can't be dragged).
Each section can add an entry, and each entry can be edited. Entries can be deleted, and
experiences, projects, and educations can be merged into a duplicate. Delete all empties the
library (entries and the profile an import fills) so a new import starts fresh. Highlights can
be dragged to a new place in their role or into another role; skills can be dragged within
their category. Every section shows its records on one long page, and dragging a section's tab
sets the default section order for new resumes.

## Contents

- `CareerLibraryPage.tsx` — page with inline resume upload above the library sections only while the library is empty, wrapped in one `DragDropProvider`; `ClearLibraryButton.tsx`
  and `ClearLibraryDialog.tsx` empty the library after confirmation; `useClearCareerLibrary.ts`
  runs `clearCareerLibrary` and refetches
- `LibraryTabs.tsx` — sticky section tabs: jump links, the section in view, section dragging, and a
  link to the first waiting review question; `librarySectionLinks.ts` — section anchors
- `ProfileSection.tsx` (contact line, always first), `SummarySection.tsx` (summary, with the persisted Include summary default for new resumes in its heading row), `LibrarySection.tsx` (heading on an ink rule, an Add button
  and an empty state), `LibraryEntry.tsx` (`LibraryEntry`, a ruled entry with an `actions` slot, and
  `CareerStop`, a role as a stop on the dated line) — display pieces
- `ExperienceSection.tsx`, `ProjectSection.tsx`, `EducationSection.tsx`, `SkillsSection.tsx`,
  `CareerContextSection.tsx` — one section each, owning its add/edit dialog
- `ExperienceFormDialog.tsx`, `ProjectFormDialog.tsx`, `EducationFormDialog.tsx`,
  `ProfileFormDialog.tsx`, `SkillFormDialog.tsx`, `CareerContextFormDialog.tsx` — save dialogs
- `EntryFormDialog.tsx` — shared dialog shell (`noValidate`, so no browser bubbles); `LibraryField.tsx` — labelled input with a red `*` for required fields and an inline `error` message
- `LibrarySaveNotice.tsx` — toast after a save (`useSaveLibraryRecord` reports it by mutation name) that also scrolls the changed section into view without moving focus, using instant scroll for reduced motion
- `libraryFormValues.ts` — `requiredFieldErrors`, `normalizeWebAddress` (adds `https://` to links), `blankToNull` and `highlightsToSave` (an unchanged bullet list is
  omitted so highlight ids stay put)
- `HighlightEditor.tsx` — add, edit, remove, and reorder a role's bullets inside the form
- `SortableHighlightList.tsx` — a role's draggable highlights (drop area works when empty)
- `SkillList.tsx` — skill chips grouped by category, draggable within a category, with edit
  and delete
- `CareerContextList.tsx` — career context entries (a requirement and the user's answer), with edit and delete
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
- Education’s Currently studying and projects’ Ongoing controls clear and disable End for the
  current edit. Both persist `ongoing: true` with `endDate: null` and restore on reopening.
  Existing entries default to false: a null end date alone stays unknown, never inferred current.
- Career context’s “Topic or question” field uses the existing `requirement` API field, including
  when prefilled from an interview or gap answer.
- Edit forms send every field, so a cleared optional field is stored as null. An experience
  update omits `highlights` when the bullets are unchanged.
- Sections are never collapsed, so every entry is always a drag target. Section dragging lives on the
  tabs, not the section headings, because a whole section can be taller than the screen.

- Certifications have a distinct section with name, issuer, issue/expiry dates, credential ID/URL, and description.
- `CertificationSection.tsx` and `CertificationFormDialog.tsx` provide certification display and CRUD.

- `certificationDateValues.ts` restores partial certification dates from API precision metadata, validates real calendar dates before save, and normalizes edits with year/month/day precision. `CertificationDateField.tsx` offers year, native month, and native date input; increasing precision clears the value rather than inventing missing parts. Blank dates remain optional. Incomplete native picker input blocks save with a field error.

## AI section review

- `LibraryWorkspace` shares review state and panel selection across the page. Selection
  stores target identity; `libraryReviewTargets` derives current source text and revisions
  from the latest library data. Above 899px, `LibraryInlineWorkspace` edits the selected detail
  right under it; at 899px and below, `LibraryAiWorkspace` opens a full-screen modal dialog.
- `LibraryDetail` keeps saved text on the left and its review note in a margin on the right, and
  highlights the selected source. Selecting a detail focuses the workspace heading and scrolls the
  panel into view only if needed. Closing restores focus without scrolling.
  Mobile exposes saved text in a disclosure.
- `LibrarySectionReview` runs review from the original section and shows progress and errors
  there. The workspace is for individual editing; it has no overview list or section picker.
- `useLibraryReview` owns explicit section review, saved assessments, freshness refetches, and
  live task progress. `LibraryAssessment` shows text-labeled red/yellow/green or neutral
  stale/unreviewed state. Up to three current enrichment questions appear together beside the assessed detail
  and in the answer form; stale questions are hidden.
- Summary, Experience, Projects, and Career context each have independent explicit review actions.
  Review/edit targets are summary, role descriptions/highlights, project descriptions, and career context
  responses; other sections and profile contact fields are not sent as context. Highlight moves
  refresh assessments after saving, because the optimistic
  library change may be visible before persistence.
- `LibraryEditControl` selects an individual edit;
  `LibraryEditPanel` renders it in the AI workspace. `useLibraryEdit` owns loading, queued
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

- An empty profile summary exposes `SummaryGenerationPanel`: explicit generation from saved career facts, editable proposal, accept/discard, retry and reload recovery. It is separate from existing single-detail improvement.

- `LibraryReviewDismissActions` exposes Nothing to add and Dismiss review from the detail and
  review-answer workspace. `useLibraryReview.dismiss` saves the decision and refreshes the section.
  Identical proposals compare against the selected field text and offer Keep saved text.

- While the library has no content, Delete all and summary generation are hidden (a hint points to import/add), and Include summary is unchecked and disabled when there is no summary.
- Review labels: "No AI review yet" / "Review out of date"; the per-detail AI button is "Rewrite with AI" (it proposes a rewrite you accept or discard).
