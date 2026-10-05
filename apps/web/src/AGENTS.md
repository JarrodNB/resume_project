# AGENTS.md — apps/web/src

## Purpose

Source of the web app, organized by feature.

## Contents

- `main.tsx` — entry point (applies the saved color theme before rendering); `App.tsx` —
  AuthProvider > SessionApolloProvider > router
- `appRoutes.tsx` — route table (public auth pages; signed-in pages inside `AppLayout`)
- `index.css` — Tailwind + shadcn theme variables: navy with warm amber/coral accents in light
  mode, teal on slate in `.dark`, plus a tint and accent color per resume section
  (`--section-<tone>`, `--section-<tone>-accent`)
- `features/auth/` — sign-in/up pages, session (JWT) context, route guards
- `features/resume-import/` — upload, live parse status, review form, import
- `features/career-library/` — career library and resumes page
- `features/jobs/` — saved jobs: add from a posting link (live scrape status), list, detail
- `features/gap-analysis/` — compare a job with the career library (shown on the job page)
- `features/resume-tailoring/` — write a resume for a job, one section at a time (`/jobs/:id/tailor`)
- `features/ai-tasks/` — `aiTaskUpdated` subscription and `useAiTaskUpdates`, shared by
  resume import, jobs, gap analysis, and resume tailoring
- `components/` — shared app components (layout, theme toggle, section cards, drag-and-drop in
  `components/dnd/`; see `components/AGENTS.md`); `components/ui/` is generated shadcn/ui
- `graphql/` — `createApolloClient.ts` (upload HTTP link + ActionCable link for subscriptions,
  401 handling), `SessionApolloProvider.tsx` (new client per session), `requestErrorMessage.ts`
  (friendly message for HTTP 429 rate limiting); `generated/` is
  GraphQL Code Generator output (don't edit)
- `lib/` — `apiConfig.ts` (API URLs), `colorTheme.ts` (light/dark preference in localStorage,
  falling back to the system setting), `formatDateRange.ts`, `utils.ts` (shadcn `cn`)
- `test/` — Vitest setup, `renderPage` helper, synthetic fixtures

## Local Rules

- Auth: the JWT is kept in localStorage and sent as `Authorization: Bearer` over HTTP and as
  `?token=` on the `/cable` WebSocket. A 401 from GraphQL ends the session.
- Signing in or out replaces the Apollo client, so no cached data leaks between users.
