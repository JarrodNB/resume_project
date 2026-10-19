# AGENTS.md — features/auth

## Purpose

Sign-up, sign-in, sign-out against Rails REST endpoints (`/auth/*`), and cookie-session state.

## Contents

- `authApi.ts` — credentialed REST calls and safe session/bootstrap responses
- `authContext.ts`, `AuthProvider.tsx`, `useAuth.ts` — session context and actions
- `RequireAuth.tsx` — `RequireAuth` (signed-in routes) and `RequireSignedOut` (auth pages)
- `SignInPage.tsx`, `SignUpPage.tsx`, `AuthForm.tsx`, `AuthPageShell.tsx` — pages and UI
- `*.test.ts(x)` — auth API and sign-in flow tests

## Local Rules

- Session credentials stay in HttpOnly cookies. Do not persist credentials in
  browser storage or read cookies from JavaScript. Clear legacy stored JWTs.
- Bootstrap has loading, signed-out, signed-in, and retryable failure states.
  Unsafe requests include the Rails CSRF token; do not silently retry mutations.
- Pages navigate after signing in; `RequireSignedOut` only redirects users who arrive already
  signed in (otherwise it races the page's own navigation).
