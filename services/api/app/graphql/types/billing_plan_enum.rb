# frozen_string_literal: true

# Description: Which plan a user is on (the values Billing::ResolvePlanService returns).
module Types
  class BillingPlanEnum < Types::BaseEnum
    extend EnumFromValues
    values_from %w[trial paid ended]
  end
end
