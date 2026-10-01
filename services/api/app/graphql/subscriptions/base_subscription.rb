# frozen_string_literal: true

# Description: Base class for GraphQL subscriptions.
# Index:
#   - current_user: the user authenticated by ApplicationCable::Connection
module Subscriptions
  class BaseSubscription < GraphQL::Schema::Subscription
    object_class Types::BaseObject
    field_class Types::BaseField
    argument_class Types::BaseArgument

    private

    # Returns the authenticated user from context.
    def current_user
      context[:current_user]
    end
  end
end
