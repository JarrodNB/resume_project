# Queues one proposal from an owned review and any nonblank indexed answers.
module Mutations
  module CareerLibrary
    class AnswerLibraryReview < Mutations::BaseMutation
      argument :review_task_id, ID, required: true
      argument :kind, String, required: true
      argument :record_id, ID, required: true
      argument :answer, String, required: false, description: "Legacy answer to the first saved question."
      argument :answers, [ Types::LibraryReviewAnswerInput ], required: false, description: "Optional answers keyed by zero-based question index; at least one nonblank answer is required."
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::CareerLibrary::AnswerReviewService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
