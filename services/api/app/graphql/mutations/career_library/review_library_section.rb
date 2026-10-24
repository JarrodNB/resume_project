# Queues a review of a selected supported career-library section.
module Mutations
  module CareerLibrary
    class ReviewLibrarySection < Mutations::BaseMutation
      argument :section, String, required: true
      field :ai_task, Types::AiTaskType

      def resolve(section:)
        payload_from(::CareerLibrary::StartReviewService.call(user: current_user, section: section), :ai_task)
      end
    end
  end
end
