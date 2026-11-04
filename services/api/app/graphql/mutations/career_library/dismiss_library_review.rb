# Dismisses saved review feedback without starting AI work or changing career facts.
module Mutations
  module CareerLibrary
    class DismissLibraryReview < Mutations::BaseMutation
      argument :review_task_id, ID, required: true
      argument :kind, String, required: true
      argument :record_id, ID, required: true
      argument :scope, String, required: true
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::CareerLibrary::DismissReviewService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
