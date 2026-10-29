# Activate exactly the saved draft version the owner has reviewed.
module Mutations
  module JobPreferences
    class Confirm < Mutations::BaseMutation
      argument :expected_version, Integer, required: true
      field :profile, Types::JobPreferenceProfileType

      def resolve(expected_version:)
        payload_from(::JobPreferences::UpdateProfileService.call(user: current_user,
          expected_version: expected_version, action: :confirm), :profile)
      end
    end
  end
end
