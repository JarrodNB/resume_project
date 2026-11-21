# AGENTS.md — features/billing

## Purpose

The "Plan & billing" page (`/account/billing`): which plan the user is on and the date that matters.

## Contents

- `BillingPage.tsx`, `billingOperations.ts` — the `me.billing` query and the four states (trial, paid, paid but cancelling, ended), the Upgrade button (`startBillingCheckout`, then a redirect to Stripe) and the bounded plan refetch after `?checkout=success`
- `PlanBillingLink.tsx` — link to the page, and the interview-failure hint for the `plan_ended` code
- `lib/planEnded.ts` holds the refusal text; `components/ErrorAlert.tsx` adds the link wherever that text is shown

## Local Rules

- Show plan names and dates only. Never show usage, spend, daily limits, comped state or Stripe ids; Rails does not expose them.
- Keep `PLAN_ENDED_MESSAGE` in step with `AiUsage::CheckAiTaskAllowanceService::PLAN_ENDED_MESSAGE`.
