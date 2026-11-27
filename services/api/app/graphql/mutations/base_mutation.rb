# frozen_string_literal: true

# Description: Base class for mutations. Mutations stay thin: they call a service object and
# return its result through `payload_from`.
# Index:
#   - current_user: the authenticated user from context
#   - payload_from: maps a ServiceResult to `{ <record_key> => value, errors: [...], error_code: ... }`
#   - error_fields_from: the `errors` and `error_code` part alone, for hand-built payloads; an
#     unknown code raises outside production
module Mutations
  class BaseMutation < GraphQL::Schema::RelayClassicMutation
    argument_class Types::BaseArgument
    field_class Types::BaseField
    input_object_class Types::BaseInputObject
    object_class Types::BaseObject

    field :errors, [ String ], null: false, description: "Validation or business-rule errors; empty on success."
    field :error_code, Types::MutationErrorCodeEnum, null: true,
      description: "Machine-readable reason for a refusal the client reacts to (such as PLAN_ENDED); null otherwise."

    # Service codes meant for the live agent's internal callbacks, not for clients
    # (Interviews::LiveConnectionAccess, RecordLiveHeartbeatService). A mutation that gets one
    # leaves it out of `error_code`.
    INTERNAL_ERROR_CODES = %w[connection_ended invalid_request unknown_usage_model].freeze

    private

    # Returns the authenticated user.
    def current_user
      context[:current_user]
    end

    # Builds the mutation payload from a ServiceResult, passing along its failure code.
    def payload_from(result, record_key)
      { record_key => result.value }.merge(error_fields_from(result))
    end

    # The `errors` and `error_code` fields for a ServiceResult. Use this for hand-built payloads
    # so the failure code is mapped in one place. An internal code (INTERNAL_ERROR_CODES) is left
    # out; the error message still explains it. Any other code clients do not know is a bug: it
    # raises outside production, and in production it is logged and left out.
    def error_fields_from(result)
      code = result.code&.to_s
      return { errors: result.errors, error_code: code } if code.nil? || Types::MutationErrorCodeEnum::CODES.include?(code)

      report_unknown_error_code(code) unless INTERNAL_ERROR_CODES.include?(code)
      { errors: result.errors, error_code: nil }
    end

    def report_unknown_error_code(code)
      message = "#{self.class.name} got error code #{code.inspect}, which is not in MutationErrorCodeEnum::CODES " \
        "or INTERNAL_ERROR_CODES"
      raise ArgumentError, message unless Rails.env.production?

      Rails.logger.warn(message)
    end
  end
end
