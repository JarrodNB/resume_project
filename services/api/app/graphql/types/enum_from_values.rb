# frozen_string_literal: true

# Description: Helper for enum types that mirror a model's string enum constant.
# Index:
#   - values_from: defines one GraphQL value per string (e.g. "needs_user_input" -> NEEDS_USER_INPUT)
module Types
  module EnumFromValues
    # Defines GraphQL enum values whose underlying values are the model's strings.
    def values_from(strings)
      strings.each { |string| value(string.upcase, value: string) }
    end
  end
end
