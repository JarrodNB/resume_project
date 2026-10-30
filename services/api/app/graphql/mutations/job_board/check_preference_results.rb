# Queue one bounded preference assessment for the user's currently loaded search results.
module Mutations
  module JobBoard
    class CheckPreferenceResults < Mutations::BaseMutation
      argument :listings, [ Types::JobPreferenceListingInput ], required: true
      argument :confirmed_revision, Integer, required: true
      field :ai_task, Types::AiTaskType

      def resolve(listings:, confirmed_revision:)
        payload_from(::JobPreferences::StartCheckService.call(user: current_user,
          listings: listings.map(&:to_h), confirmed_revision: confirmed_revision), :ai_task)
      end
    end
  end
end
