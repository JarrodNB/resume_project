# Works out which plan a user is on right now: trial, paid or ended.
#
# Reads only Rails data (the user's trial date and their billing subscription row); it never
# calls the payment provider. Everything else asks this service instead of re-deriving the plan.
# Also says how much known AI spend the user may use per UTC day (their hidden daily cap).
# The cap is never shown to users. A confirmed user whose trial date is missing (confirmed while
# the trial dates were still being added) gets the trial from seven days after confirming.
# Index:
#   - Plan: can_manage_billing (a Stripe customer exists), plan, trial_ends_at, current_period_end, cancel_at_period_end, daily_spend_cap_microdollars, comped, ai_access?
#   - call: returns a Plan for the user
module Billing
  class ResolvePlanService < ApplicationService
    Plan = Data.define(:plan, :trial_ends_at, :current_period_end, :cancel_at_period_end, :daily_spend_cap_microdollars, :comped, :can_manage_billing) do
      # A comped user (operator cap override) may use AI on any plan; otherwise an ended plan may not.
      def ai_access?
        comped || plan != "ended"
      end
    end

    def initialize(user:)
      @user = user
    end

    # Paid wins over trial; a trial counts until trial_ends_at; no trial date and never confirmed means the trial never started.
    def call
      subscription = @user.billing_subscription
      paid = subscription && BillingSubscription::PAID_STATUSES.include?(subscription.status)
      trial_ends_at = effective_trial_ends_at
      plan = if paid then "paid"
      elsif trial_ends_at && trial_ends_at > Time.current then "trial"
      else "ended"
      end
      plan_cap = plan == "paid" ? PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS : TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS
      success(Plan.new(plan: plan, trial_ends_at: trial_ends_at,
        current_period_end: subscription&.current_period_end,
        cancel_at_period_end: subscription ? subscription.cancel_at_period_end : false,
        daily_spend_cap_microdollars: @user.daily_ai_spend_cap_microdollars || plan_cap,
        comped: @user.comped?,
        can_manage_billing: subscription.present?))
    end

    private

    def effective_trial_ends_at
      @user.trial_ends_at || (@user.confirmed_at && @user.confirmed_at + Accounts::ConfirmAccountService::TRIAL_LENGTH)
    end
  end
end
