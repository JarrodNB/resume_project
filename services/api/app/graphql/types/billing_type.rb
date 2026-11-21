# frozen_string_literal: true

# Description: The signed-in user's plan and its dates, for the Plan & billing page.
# Deliberately small: AI caps, spend, comped state and Stripe ids are never exposed here.
# Index:
#   - plan (trial / paid / ended), trial_ends_at, current_period_ends_at, cancel_at_period_end, can_manage_billing
module Types
  class BillingType < Types::BaseObject
    field :plan, Types::BillingPlanEnum, null: false
    field :trial_ends_at, GraphQL::Types::ISO8601DateTime, description: "When the free trial ends (or ended)."
    field :current_period_ends_at, GraphQL::Types::ISO8601DateTime, description: "Next renewal, or the end date when cancelling. Paid plans only."
    field :cancel_at_period_end, Boolean, null: false
    field :can_manage_billing, Boolean, null: false, description: "True when the user has a Stripe customer, so the billing portal can open."

    def current_period_ends_at = object.current_period_end
  end
end
