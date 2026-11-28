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
| `ended` | Everything else. AI work is refused with a subscribe message and `errorCode: PLAN_ENDED` on the mutation payload; the web app uses the code to link to `/account/billing`. |

Cancelling keeps `paid` until the period ends (`cancel_at_period_end`), then the status becomes
`canceled` and the plan is `ended`. `unpaid`, `canceled`, `incomplete` and `incomplete_expired`
are not paid.

**Spend cap override.** An operator can set `users.daily_ai_spend_cap_microdollars` from the Rails
console. It replaces the plan's daily cap size and nothing else: it does not change the plan or
grant access. Once the plan is `ended` there is no AI access unless the user pays. Only `trial` and
`paid` plans have AI access (`Plan#ai_access?`).

## Trial

- `Billing::Trial` is the one home of the trial rule (7-day `LENGTH`, `start!`, `ends_at_for`).
  `trial_ends_at` is set when the email is confirmed (`Accounts::ConfirmAccountService` calls `Billing::Trial.start!`): confirmed
  time plus 7 days. One trial per account, ever; re-subscribing never restarts it.
- The migration that added the column gave every already-confirmed user launch time plus 7 days.
  A confirmed user still missing `trial_ends_at` (confirmed between that migration and the new code
  going live) gets confirmed time plus 7 days from `Billing::Trial.ends_at_for` (used by `Billing::ResolvePlanService`); the trial-ending
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
users are skipped by the check. Tasks and embedding receipts keep whether they counted toward
the trial budget when created; upgrading or ending a subscription does not reclassify earlier usage.
Existing receipts are backfilled from the subscription status at migration time because historical
plan changes were not recorded. This ensures a wave of fake
signups cannot block paying customers.

## Live interview budget

Live interviews have their own hidden budget, separate from the hidden daily cap: US$1.00 over
the whole trial, US$1.50 per UTC day on a paid plan, none once the plan has ended
(`Interviews::LiveAllowance`). It is spent by what live sessions actually cost, not by time, and
users see nothing about it until it is reached. A new live interview needs US$0.50 left. See
[time, live budget and heartbeats](interview-sessions.md#time-live-budget-and-heartbeats).

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
- Scheduled cancellations use Stripe’s `cancel_at` date when present, including when `cancel_at_period_end` is false, so the billing page shows when access ends instead of a renewal.
- **Sync job.** `Billing::SyncSubscriptionService` always fetches the subscription's current
  state from Stripe and copies it to `billing_subscriptions`. Because it never trusts the event
  body, duplicate and out-of-order deliveries end in the same correct state. It fetches again
  after locking the row, so two jobs at once cannot write older state. Guards: an old canceled
  subscription never overwrites a newer one that is still paid; and if a second paid subscription
  arrives for a row that already holds a paid one (two checkouts at once), the sync checks that
  Stripe still says the recorded subscription is paid, then the row keeps the first,
  the newcomer is cancelled right away, and a warning log names both ids so an operator can refund it.
  A subscription with no billing row whose metadata names a user that no longer exists (account
  deleted, or whose billing row vanished mid-sync) is cancelled with a refund warning, but only when
  it is marked `source=careerdrafter` (set on every subscription we start at Checkout). Anything
  else, including one that names no user, is logged and skipped.
  Stripe has already had its 200 by the time the job runs, so a lost sync is never redelivered. The
  job therefore retries `Billing::Gateway::Unavailable` up to 16 attempts with Rails'
  `polynomially_longer` waits (`n**4 + 2` seconds after attempt `n`), about 49.5 hours (just over two
  days) in total. A subscription Stripe no longer has (`Gateway::NotFound`) is logged and dropped.
- **Daily reconciliation.** `Billing::ReconcileSubscriptionsJob` runs every day at 04:40 UTC. For
  each billing row it asks Stripe for the customer's subscriptions that have not ended, adds the
  one the row records if the row still thinks it is live, and queues the usual sync for each. That
  catches a sync lost after its retry window, a checkout whose webhook never arrived, and a
  cancellation we never heard about, within a day. It costs one Stripe list call per customer.
- **One Stripe account per environment.** Production, staging and local must each use their own
  Stripe account or test mode. The sync cancels a subscription whose metadata user does not exist
  in this database (see above), so two environments sharing one Stripe account would cancel each
  other's real subscriptions.
- **Account deletion.** `Accounts::DeleteAccountService` cancels every not-yet-ended subscription
  of the user's Stripe customer right away (no refund) before deleting the user. It asks Stripe for
  the customer's subscriptions instead of trusting our row, because a user can finish Checkout and
  delete their account before the webhook sync has run. If Stripe fails, deletion is blocked with a
  retry message; a customer Stripe no longer has counts as done. Locally, deleting an account that
  has a Stripe customer needs a Stripe test key. The seeded QA accounts have no Stripe records (a
  ten-year trial with the paid daily cap instead), so they can be deleted without one.
- **GraphQL.** `me.billing { plan, trialEndsAt, currentPeriodEndsAt, cancelAtPeriodEnd, canManageBilling, priceLabel }`. `priceLabel` (such as "$12/month") comes from the Stripe price and is null when it can't be read. The web page disables Upgrade while it waits for a just-paid plan to appear.

## Known limitations

- **Deletion cancels first.** Account deletion cancels the Stripe subscription before deleting the
  account. If the delete itself then fails, the account stays but its subscription is already
  cancelled (no refund); the user can subscribe again from Plan & billing.
- **The Terms state the price in words.** The billing page reads its price from the Stripe price
  (`Billing::PlanPrice`, cached for an hour), so it always matches Checkout. The Terms page says
  "$12 per month" as legal text; a price change needs advance notice anyway, so update the Terms
  as part of that notice.

## Configuration

Set in `services/api/.env` (local) and `/opt/app/.env` (production); examples in
`services/api/.env.example` and `infra/compose/.env.example`.

| Variable | Meaning |
| -------- | ------- |
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_test_...` locally, live key in production). Enough for the portal and for cancelling on account deletion |
| `STRIPE_PRICE_ID` | The $12/month price (`price_...`). Checkout charges it and the billing page shows it |
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
