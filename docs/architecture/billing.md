# Billing

Careerdrafter gives every verified user a free week of AI features, then asks for a $12/month
Stripe subscription. Everything that does not use AI (resumes, jobs, career library, exports)
works without paying. Rails stores the plan; Stripe is only asked when something changes.

## Plans

`Billing::ResolvePlanService` is the one place that answers "what plan is this user on?". It
reads only Rails data and never calls Stripe.

| Plan | When |
| ---- | ---- |
| `paid` | The user's `billing_subscriptions` row has status `active` or `past_due` (Stripe is still retrying the card). Paid wins over trial. |
| `trial` | No paid subscription and `users.trial_ends_at` is in the future. |
| `ended` | Everything else. AI work is refused with a subscribe message and a link to `/account/billing`. |

Cancelling keeps `paid` until the period ends (`cancel_at_period_end`), then the status becomes
`canceled` and the plan is `ended`. `unpaid`, `canceled`, `incomplete` and `incomplete_expired`
are not paid.

**Comped accounts.** An operator can set `users.daily_ai_spend_cap_microdollars` from the Rails
console (`User#comped?`). It replaces the plan's daily cap and grants AI access even when the plan is `ended`.

## Trial

- `trial_ends_at` is set when the email is confirmed (`Accounts::ConfirmAccountService`): confirmed
  time plus 7 days. One trial per account, ever; re-subscribing never restarts it.
- The migration that added the column gave every already-confirmed user launch time plus 7 days.
  A confirmed user still missing `trial_ends_at` (confirmed between that migration and the new code
  going live) gets confirmed time plus 7 days from `Billing::ResolvePlanService`; the trial-ending
  email does not cover that rare case.
- `Accounts::SendTrialEndingEmailsJob` (daily, `config/recurring.yml`) emails non-paid users whose
  trial ends within about a day. `trial_ending_email_sent_at` makes it once per user.

## Hidden daily spend caps

Each user has one cap on known AI cost per UTC day, shared by general AI and spoken interviews:
$0.25 on trial, $2.00 on paid (`TRIAL_DAILY_AI_SPEND_CAP_USD`, `PAID_DAILY_AI_SPEND_CAP_USD`).
`AiUsage::CheckAiTaskAllowanceService` enforces it; see
[AI safety and usage](ai-safety-and-usage.md#usage-limits) for the full order of checks.

The caps exist to stop stolen or abusive accounts, not to meter normal use. They are hidden on
purpose: no GraphQL field returns a cap or a spend amount, and the refusal message has no number
("You've reached today's usage limit. Try again tomorrow."). Showing them would let an attacker
tune abuse to just under the limit. Upgrading mid-day applies the paid cap against today's spend so far.

The site-wide daily budget (`AI_SITE_DAILY_BUDGET_USD`) applies to **trial users only**. Paid
users are skipped by the check and their spend does not count toward it, so a wave of fake
signups cannot block paying customers.

## Stripe

- **Gateway seam.** `Billing::Gateway` is the only code that talks to Stripe. `Billing::StripeGateway`
  is the real adapter (the `stripe` gem); tests use `FakeStripeGateway`. It is chosen once in
  config (`config.x.billing_gateway`). It turns every Stripe error into `Gateway::Unavailable` (try
  again later) or `Gateway::NotFound` (Stripe has no such thing), so no other code names Stripe's
  error classes; the sync job retries on `Unavailable` and logs and drops the job on `NotFound`. Without the secret key, checkout and portal fail with a clear message (checkout also needs the price id)
  and limit checks still work.
- **Checkout.** The `startBillingCheckout` mutation (`Billing::StartCheckoutService`) creates or
  reuses one Stripe customer per user (Stripe is called with no lock held; the idempotency key and the unique user index settle double clicks), turns on automatic tax, passes the user id as metadata,
  and returns the Stripe-hosted URL. `Billing::BillingPage.url` builds the return links (and the trial email's link) from `WEB_APP_URL`. It refuses when the user is already paid. The success and
  cancel URLs go back to `/account/billing`; the webhook, not the redirect, makes the user paid.
- **Portal.** `startBillingPortal` returns a Customer Portal URL for the user's customer.
- **Webhook.** `POST /billing/stripe/webhook` (`Billing::StripeWebhooksController`) checks the
  Stripe signature on the raw body (`STRIPE_WEBHOOK_SECRET`) and answers 400 if it is bad. For
  `checkout.session.completed` and `customer.subscription.created/updated/deleted` it queues
  `Billing::SyncSubscriptionJob` with the subscription id and answers 200. Other events get 200 and are ignored.
- **Sync job.** `Billing::SyncSubscriptionService` always fetches the subscription's current
  state from Stripe and copies it to `billing_subscriptions`. Because it never trusts the event
  body, duplicate and out-of-order deliveries end in the same correct state. It fetches again
  after locking the row, so two jobs at once cannot write older state. Guards: an old canceled
  subscription never overwrites a newer one that is still paid; and if a second paid subscription
  arrives for a row that already holds a paid one (two checkouts at once), the row keeps the first,
  the newcomer is cancelled right away, and a warning log names both ids so an operator can refund it.
  A subscription with no billing row whose metadata names a user that no longer exists (account
  deleted) is cancelled with a refund warning; one that names no user is logged and skipped.
- **Account deletion.** `Accounts::DeleteAccountService` cancels every not-yet-ended subscription
  of the user's Stripe customer right away (no refund) before deleting the user. It asks Stripe for
  the customer's subscriptions instead of trusting our row, because a user can finish Checkout and
  delete their account before the webhook sync has run. If Stripe fails, deletion is blocked with a
  retry message; a customer Stripe no longer has counts as done.
- **GraphQL.** `me.billing { plan, trialEndsAt, currentPeriodEndsAt, cancelAtPeriodEnd, canManageBilling }`. The web page disables Upgrade while it waits for a just-paid plan to appear.

## Configuration

Set in `services/api/.env` (local) and `/opt/app/.env` (production); examples in
`services/api/.env.example` and `infra/compose/.env.example`.

| Variable | Meaning |
| -------- | ------- |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_test_...` locally, live key in production). Enough for the portal and for cancelling on account deletion |
| `STRIPE_PRICE_ID` | The $12/month price (`price_...`). Only checkout needs it |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) |
| `TRIAL_DAILY_AI_SPEND_CAP_USD` | Trial daily cap, default 0.25 |
| `PAID_DAILY_AI_SPEND_CAP_USD` | Paid daily cap, default 2.00 |

Try it locally in Stripe test mode: see [Billing in Stripe test mode](../testing.md#billing-in-stripe-test-mode).

## Production rollout checklist

1. Put the live `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in
   `/opt/app/.env` and copy them to Parameter Store (`/jobapp/prod/<NAME>`).
2. In Stripe (live mode), register the webhook endpoint
   `https://api.careerdrafter.app/billing/stripe/webhook` for `checkout.session.completed`,
   `customer.subscription.created`, `customer.subscription.updated` and
   `customer.subscription.deleted`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
3. Turn on Stripe Tax.
4. Configure the Customer Portal: cancel at period end, update card, show invoices.
5. Create the $12/month recurring price and set `STRIPE_PRICE_ID` to it.
6. Restart the `api` and jobs worker services (they read `.env` only at start); see `infra/compose/README.md`.
7. Smoke test: upgrade with a real card, confirm the plan turns Paid, then cancel and refund in Stripe if it was only a test.
