# frozen_string_literal: true

# Description: Base class for mutations. Mutations stay thin: they call a service object and
# return its result through `payload_from`.
# Index:
#   - current_user: the authenticated user from context
#   - payload_from: maps a ServiceResult to `{ <record_key> => value, errors: [...] }`
module Mutations
  class BaseMutation < GraphQL::Schema::RelayClassicMutation
    argument_class Types::BaseArgument
    field_class Types::BaseField
    input_object_class Types::BaseInputObject
    object_class Types::BaseObject

    field :errors, [ String ], null: false, description: "Validation or business-rule errors; empty on success."

    private

    # Returns the authenticated user.
    def current_user
      context[:current_user]
    end

    # Builds the mutation payload from a ServiceResult.
    def payload_from(result, record_key)
      { record_key => result.value, errors: result.errors }
    end
  end
end
