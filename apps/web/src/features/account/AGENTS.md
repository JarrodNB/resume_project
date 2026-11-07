# AGENTS.md — features/account

## Purpose

The signed-in user's own data: download a JSON export and permanently delete the account.

## Contents

- `AccountDataSection.tsx` — "Your data" section shown on `/account/security`
- `useAccountExport.ts`, `accountOperations.ts` — `accountExport` GraphQL query saved as a file
- `DeleteAccountDialog.tsx` — password-confirmed `DELETE /auth/account`
- `AccountDeletedPage.tsx` — public `/account-deleted` confirmation

## Local Rules

- Deletion always asks for the current password; never add a one-click path.
- The export bypasses the Apollo cache; do not keep it in memory or browser storage.
- Keep the dialog copy in step with what Rails actually deletes (`docs/architecture/privacy-and-data.md`).
