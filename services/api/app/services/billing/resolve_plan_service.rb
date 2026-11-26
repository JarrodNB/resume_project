# Works out which plan a user is on right now: trial, paid or ended.
#
# Reads only Rails data (the user's trial date and their billing subscription row); it never
# calls the payment provider. Everything else asks this service instead of re-deriving the plan.
# Also says how much known AI spend the user may use per UTC day (their hidden daily cap).
# The cap is never shown to users. A confirmed user whose trial date is missing (confirmed while
# the trial dates were still being added) gets the trial from seven days after confirming (Billing::Trial).
# Index:
#   - Plan: can_manage_billing (a Stripe customer exists), payment_failed (paid, but the last charge failed and Stripe is retrying), plan, trial_ends_at, current_period_end, cancel_at_period_end, daily_spend_cap_microdollars, trial?, paid?, ended?, ai_access?
#   - call: returns a Plan for the user
module Billing
  class ResolvePlanService < ApplicationService
    Plan = Data.define(:plan, :trial_ends_at, :current_period_end, :cancel_at_period_end, :daily_spend_cap_microdollars, :can_manage_billing,
      :payment_failed) do
      def trial? = plan == "trial"
      def paid? = plan == "paid"
      def ended? = plan == "ended"

      # Only trial and paid users may use AI. The operator cap override changes the cap size, never this.
      def ai_access? = !ended?
    end

    def initialize(user:)
      @user = user
    end

    # Paid wins over trial; a trial counts until trial_ends_at; no trial date and never confirmed means the trial never started.
    def call
      subscription = @user.billing_subscription
      paid = subscription&.paid? || false
      trial_ends_at = Trial.ends_at_for(@user)
      plan = if paid then "paid"
      elsif trial_ends_at && trial_ends_at > Time.current then "trial"
      else "ended"
      end
      plan_cap = paid ? PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS : TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS
      success(Plan.new(plan: plan, trial_ends_at: trial_ends_at,
        current_period_end: subscription&.current_period_end,
        cancel_at_period_end: subscription ? subscription.cancel_at_period_end : false,
        daily_spend_cap_microdollars: @user.daily_ai_spend_cap_microdollars || plan_cap,
        can_manage_billing: subscription.present?, payment_failed: subscription&.status == "past_due"))
    end
  end
end
