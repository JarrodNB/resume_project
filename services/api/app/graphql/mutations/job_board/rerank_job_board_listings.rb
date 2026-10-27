# Queues an optional ranking of shared search listings for the authenticated user.
module Mutations
  module JobBoard
    class RerankJobBoardListings < Mutations::BaseMutation
      argument :keyword, String, required: true
      argument :listing_ids, [ ID ], required: true
      field :ai_task, Types::AiTaskType

      def resolve(keyword:, listing_ids:)
        payload_from(::JobBoard::StartRerankingService.call(user: current_user,
          keyword: keyword, listing_ids: listing_ids), :ai_task)
      end
    end
  end
end
