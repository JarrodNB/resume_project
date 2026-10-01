# AGENTS.md — features/auth

## Purpose

Sign-up, sign-in, sign-out against the Rails REST endpoints (`/auth/*`), and the session JWT.

## Contents

- `authApi.ts` — REST calls; returns the JWT from the `Authorization` response header
- `authTokenStorage.ts` — JWT in localStorage
- `authContext.ts`, `AuthProvider.tsx`, `useAuth.ts` — session context and actions
- `RequireAuth.tsx` — `RequireAuth` (signed-in routes) and `RequireSignedOut` (auth pages)
- `SignInPage.tsx`, `SignUpPage.tsx`, `AuthForm.tsx`, `AuthPageShell.tsx` — pages and UI
- `*.test.ts(x)` — auth API and sign-in flow tests

## Local Rules

- Pages navigate after signing in; `RequireSignedOut` only redirects users who arrive already
  signed in (otherwise it races the page's own navigation).
