# AGENTS.md — features/auth

## Purpose

Sign-up, sign-in, sign-out against Rails REST endpoints (`/auth/*`), and cookie-session state.

## Contents

- `authApi.ts` — credentialed REST calls and safe session/bootstrap responses
- `authContext.ts`, `AuthProvider.tsx`, `useAuth.ts` — session context and actions
- `RequireAuth.tsx` — `RequireAuth` (signed-in routes) and `RequireSignedOut` (auth pages)
- `SignInPage.tsx`, `SignUpPage.tsx`, `AuthForm.tsx`, `AuthPageShell.tsx` — pages and UI
- `PasswordInput.tsx` — shared password-manager-friendly input and accessible visibility toggle;
  password acceptance remains server-owned, with no native truncating maximum length
- `*.test.ts(x)` — auth API and sign-in flow tests
- `VerifyEmailPage.tsx`, `ResendConfirmationForm.tsx`, `confirmationLink.ts` — public
  explicit verification and resend; capture/clear fragment before app bootstrap
- `ForgotPasswordPage.tsx`, `PasswordUpdatePage.tsx`, `resetPasswordLink.ts` — public recovery
  and signed-in current-password change; success survives session/cache refresh on a public route

## Local Rules

- Session credentials stay in HttpOnly cookies. Do not persist credentials in
  browser storage or read cookies from JavaScript. Clear legacy stored JWTs.
- Bootstrap has loading, signed-out, signed-in, and retryable failure states.
  Unsafe requests include the Rails CSRF token; do not silently retry mutations.
  Explicit `invalid_csrf` failures refresh bootstrap through the provider, clearing
  stale account forms; ordinary validation errors do not reset session state.
- Pages navigate after signing in; `RequireSignedOut` only redirects users who arrive already
  signed in (otherwise it races the page's own navigation).
- Signup requests verification without creating a session. `/verify-email` is public
  even for signed-in browsers and never switches accounts. Keep tokens in memory only.
- `/reset-password` is public even for signed-in browsers. Capture/clear its fragment before
  startup and send the token only on explicit submit. Password success refreshes local and
  sibling-tab sessions, preserving an unrelated account as reported by server bootstrap.
- `/account/security` stays inside the signed-in workspace. Show the current account and
  explain session sign-out before password submission; public reset pages use the auth shell.
