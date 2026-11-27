# frozen_string_literal: true

# Description: Machine-readable reason a mutation was refused, so clients never match on message text.
# PLAN_ENDED: the free trial is over and AI work needs a subscription.
# LIVE_ALLOWANCE_LOW: fewer than 5 live interview minutes are left to start a live interview.
# Services use other codes internally (such as the live agent's `connection_ended`); mutations
# return only these (BaseMutation#error_fields_from leaves the others out).
module Types
  class MutationErrorCodeEnum < Types::BaseEnum
    extend EnumFromValues
    CODES = %w[plan_ended live_allowance_low].freeze
    values_from CODES
  end
end
