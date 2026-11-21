# AGENTS.md — features/billing

## Purpose

The "Plan & billing" page (`/account/billing`): which plan the user is on and the date that matters.

## Contents

- `BillingPage.tsx`, `billingOperations.ts` — the `me.billing` query and the four states (trial, paid, paid but cancelling, ended), the Upgrade button (`startBillingCheckout`, then a redirect to Stripe), the Manage billing button (`startBillingPortal`, shown when `canManageBilling`) and the bounded plan refetch after `?checkout=success`
- `PlanBillingLink.tsx` — link to the page; `MutationErrorAlert` (shows the link when a mutation payload has `errorCode: PLAN_ENDED`); `PlanEndedFailureLink` and `PlanEndedHint` (the link for chat and interview failures with the `plan_ended` failure code)
- `lib/planEnded.ts` holds the code constants and the text shown for the failure code

## Local Rules

- Show plan names and dates only. Never show usage, spend, daily limits, comped state or Stripe ids; Rails does not expose them.
- Recognise an ended trial by machine code only (`errorCode` on mutation payloads, `plan_ended` failure code on operations). Never compare message text. Every AI-start mutation document requests `errorCode` and its screen uses `MutationErrorAlert`.
