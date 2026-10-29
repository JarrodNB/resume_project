# Start an owner-scoped preference assessment using the current search result's source digest.
module Mutations
  module JobBoard
    class CheckPreferences < Mutations::BaseMutation
      argument :listing_id, ID, required: true
      argument :expected_digest, String, required: true
      argument :confirmed_revision, Integer, required: true
      field :ai_task, Types::AiTaskType

      def resolve(listing_id:, expected_digest:, confirmed_revision:)
        payload_from(::JobPreferences::StartCheckService.call(user: current_user,
          listing_id: listing_id, expected_digest: expected_digest, confirmed_revision: confirmed_revision), :ai_task)
      end
    end
  end
end
