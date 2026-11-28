# frozen_string_literal: true

# Description: Machine-readable reason a mutation was refused, so clients never match on message text.
# PLAN_ENDED: the free trial is over and AI work needs a subscription.
# LIVE_ALLOWANCE_LOW: fewer than 5 live interview minutes are left to start a live interview.
# Services use other codes internally (such as the live agent's `connection_ended`); a service
# a mutation calls must not return those, and BaseMutation#error_fields_from raises outside
# production (and leaves the code out in production) for any code not listed here.
module Types
  class MutationErrorCodeEnum < Types::BaseEnum
    extend EnumFromValues
    CODES = %w[plan_ended live_allowance_low].freeze
    values_from CODES
  end
end
