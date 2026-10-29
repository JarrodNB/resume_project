# Clear this owner's private preference text while retaining a stale-write fence.
module Mutations
  module JobPreferences
    class Clear < Mutations::BaseMutation
      argument :expected_version, Integer, required: true
      field :profile, Types::JobPreferenceProfileType

      def resolve(expected_version:)
        payload_from(::JobPreferences::UpdateProfileService.call(user: current_user,
          expected_version: expected_version, action: :clear), :profile)
      end
    end
  end
end
