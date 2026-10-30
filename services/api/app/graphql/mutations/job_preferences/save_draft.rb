# Save an owner-scoped draft without activating it for matching.
module Mutations
  module JobPreferences
    class SaveDraft < Mutations::BaseMutation
      argument :expected_version, Integer, required: true
      argument :criteria, [ Types::JobPreferenceCriterionInput ], required: true
      field :profile, Types::JobPreferenceProfileType

      def resolve(expected_version:, criteria:)
        payload_from(::JobPreferences::UpdateProfileService.call(user: current_user,
          expected_version: expected_version, criteria: criteria.map(&:to_h), action: :save_draft), :profile)
      end
    end
  end
end
