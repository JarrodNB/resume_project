# AGENTS.md — apps/web/src

## Purpose

Source of the web app, organized by feature.

## Contents

- `main.tsx` — entry point; `App.tsx` — AuthProvider > SessionApolloProvider > router
- `appRoutes.tsx` — route table (public auth pages; signed-in pages inside `AppLayout`)
- `index.css` — Tailwind + shadcn theme variables
- `features/auth/` — sign-in/up pages, session (JWT) context, route guards
- `features/resume-import/` — upload, live parse status, review form, import
- `features/career-library/` — career library and resumes page
- `components/` — shared app components (`AppLayout`, `ErrorAlert`); `components/ui/` is
  generated shadcn/ui
- `graphql/` — `createApolloClient.ts` (upload HTTP link + ActionCable link for subscriptions,
  401 handling), `SessionApolloProvider.tsx` (new client per session), `requestErrorMessage.ts`
  (friendly message for HTTP 429 rate limiting); `generated/` is
  GraphQL Code Generator output (don't edit)
- `lib/` — `apiConfig.ts` (API URLs), `formatDateRange.ts`, `utils.ts` (shadcn `cn`)
- `test/` — Vitest setup, `renderPage` helper, synthetic fixtures

## Local Rules

- Auth: the JWT is kept in localStorage and sent as `Authorization: Bearer` over HTTP and as
  `?token=` on the `/cable` WebSocket. A 401 from GraphQL ends the session.
- Signing in or out replaces the Apollo client, so no cached data leaks between users.
