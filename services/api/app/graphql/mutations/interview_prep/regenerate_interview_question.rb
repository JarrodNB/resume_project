# Description: Authorized interview practice operation delegated to a Rails service.
# Index:
#   - resolve: scopes records to the signed-in user and returns validation errors
module Mutations
  module InterviewPrep
    class RegenerateInterviewQuestion < Mutations::BaseMutation
      argument :question_set_id, ID, required: true
      argument :question_id, ID, required: true
      argument :confirmed, Boolean, required: false, default_value: false
      field :ai_task, Types::AiTaskType

      # Authorizes records before invoking the domain service.
      def resolve(question_set_id:, question_id:, confirmed:)
        question = current_user.interview_question_sets.find(question_set_id).questions.find(question_id)
        payload_from(::InterviewPrep::StartQuestionTaskService.call(user: current_user, question: question, task_type: "regenerate_interview_question", confirmed: confirmed), :ai_task)
      end
    end
  end
end
