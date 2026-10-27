# AGENTS.md — apps/web/src

## Purpose

Source of the web app, organized by feature.

## Contents

- `main.tsx` — entry point (applies the saved color theme before rendering); `App.tsx` —
  AuthProvider > SessionApolloProvider > router
- `appRoutes.tsx` — route table (public auth pages; signed-in pages inside `AppLayout`)
- `index.css` — Tailwind + shadcn theme variables: warm paper and forest ink in light
  mode, deep forest in `.dark`; shared responsive workspace/auth styles and section icon accents
  (`--section-<tone>-accent`). Root `DESIGN.md` records the main app visual system
- `features/auth/` — sign-in/up pages, cookie-session bootstrap/context, route guards
- `features/resume-import/` — upload, live parse status, review form, import
- `features/career-library/` — career library page
- `features/job-board/` — shared US listing search with date, resolved city/state, employment, remote arrangement, salary, company, experience, and sorting controls, plus a local hide-saved toggle; temporary opt-in career-library reranking of loaded results, paginated results, and explicit import into private Jobs (`/job-board`); Rails owns provider access, caching, and duplicate matching
- `features/jobs/` — saved jobs: add from a posting link or a pasted ad (live task status) or by hand, list,
  detail, edit, stage, and delete
- `features/study-guides/` — description-only study guides on saved jobs, paginated history, selected-guide reading, per-guide freshness and live generation status
- `features/gap-analysis/` — compare a job with the career library (shown on the job page)
- `features/resumes/` — saved resumes list and one resume's editor (`/resumes`, `/resumes/:id`)
- `features/resume-tailoring/` — generate and review a complete resume draft for a job, then edit the
  saved resume, with an actual-size PDF preview (`/jobs/:id/tailor`)
- `features/interview-prep/` — persistent numbered interview sets, question generation, live status,
  five collapsible question cards, saved answer drafts, feedback/examples, replacement, unsaved navigation warnings, and confirmed deletion
- `features/interviews/` — real spoken interviews, saved-job setup at `/jobs/:jobId/interview`, fictional-role setup, browser recording, owned saved dialogue, direct private uploads, subscription recovery, and saved-audio playback; scripted creation is retired, independent of written practice
- `features/ai-tasks/` — `aiTaskUpdated` subscription and `useAiTaskUpdates`, shared by
  resume import, jobs, gap analysis, resume tailoring, and interview prep
- `components/` — shared app components (layout, theme toggle, section cards, drag-and-drop in
  `components/dnd/`; see `components/AGENTS.md`); `components/ui/` is generated shadcn/ui
- `graphql/` — `createApolloClient.ts` (upload HTTP link + ActionCable link for subscriptions,
  401/explicit CSRF rejection handling), `SessionApolloProvider.tsx` (new client per session), `requestErrorMessage.ts`
  (friendly message for HTTP 429 rate limiting); `generated/` is
  GraphQL Code Generator output (don't edit)
- `lib/` — `productName.ts` (product name; localStorage keys are derived from it), `textLimits.ts`
  (character caps matching Rails `TextLimits`), `apiConfig.ts` (API URLs), `colorTheme.ts` (light/dark preference in localStorage,
  falling back to the system setting), `openSections.ts` (which page sections are open, also
  in localStorage; missing ids stay collapsed), `formatDateRange.ts`, `utils.ts` (shadcn `cn`)
- `test/` — Vitest setup, `renderPage` helper, synthetic fixtures

## Local Rules

- Auth uses an HttpOnly cookie. Bootstrap retrieves safe user state and a CSRF token;
  HTTP requests send credentials and unsafe requests include the Rails CSRF header.
  WebSockets use the same cookie, without URL credentials. A GraphQL 401 or explicit `invalid_csrf` rejection refreshes local session state
  without replaying writes.
- Signing in or out replaces the Apollo client, so no cached data leaks between users.

- Certifications have a distinct section with name, issuer, issue/expiry dates, credential ID/URL, and description.
- `lib/formatCertificationDates.ts` formats explicit issue and expiry labels.
