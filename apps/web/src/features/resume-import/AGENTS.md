# AGENTS.md — features/resume-import

## Purpose

Import an existing resume: upload a PDF/DOCX (`parseResume`), follow the AI parse live
(`aiTaskUpdated`), let the user review and edit the result, then `importParsedResume`.

## Contents

- `ResumeUploadPage.tsx` (`/import`) — `ResumeDropzone.tsx` + `resumeFileValidation.ts`
- `ResumeImportTaskPage.tsx` (`/import/:aiTaskId`) — picks the step from the task state:
  `ParseTaskStatusCard.tsx` (connecting, parsing, failed, already imported) or
  `ParsedResumeReview.tsx` (form wired to the import mutation)
- `review/` — the editable form: `ParsedResumeForm.tsx` plus one fields component per section,
  and generic `TextField`, `StringListField`, `EditableList`, `DateRangeFields`
- `parsedResume.ts` — TypeScript mirror of `services/ai/schemas/parsed_resume.py`
- `resumeImportOperations.ts` — GraphQL operations; `useParseResume`, `useAiTaskUpdates`,
  `useImportParsedResume` — hooks
- `*.test.ts(x)` — validation, parsing defaults, review form, task page states

## Local Rules

- `parsedResume.ts` must stay in sync with the Pydantic `ParsedResume` (snake_case keys, partial
  dates as "YYYY-MM" / "YYYY"). The edited object is sent back as-is.
- The task page must work on reload: the subscription sends the task's current state first.
