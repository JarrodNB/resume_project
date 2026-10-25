# Queues an individual proposal from the exact owned review question and user's answer.
module Mutations
  module CareerLibrary
    class AnswerLibraryReview < Mutations::BaseMutation
      argument :review_task_id, ID, required: true
      argument :kind, String, required: true
      argument :record_id, ID, required: true
      argument :answer, String, required: true
      field :ai_task, Types::AiTaskType

      def resolve(**arguments)
        payload_from(::CareerLibrary::AnswerReviewService.call(user: current_user, **arguments), :ai_task)
      end
    end
  end
end
