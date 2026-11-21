# frozen_string_literal: true

# Description: Machine-readable reason a mutation was refused, so clients never match on message text.
# PLAN_ENDED: the free trial is over and AI work needs a subscription.
module Types
  class MutationErrorCodeEnum < Types::BaseEnum
    extend EnumFromValues
    values_from %w[plan_ended]
  end
end
