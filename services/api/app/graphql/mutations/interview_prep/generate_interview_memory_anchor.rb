# Description: Authorized interview practice operation delegated to a Rails service.
# Index:
#   - resolve: scopes records to the signed-in user and returns validation errors
module Mutations
  module InterviewPrep
    class GenerateInterviewMemoryAnchor < Mutations::BaseMutation
      argument :question_set_id, ID, required: true
      argument :question_id, ID, required: true
      argument :answer_text, String, required: true
      argument :memory_anchor, String, required: true
      field :ai_task, Types::AiTaskType

      # Authorizes records before invoking the domain service.
      def resolve(question_set_id:, question_id:, answer_text:, memory_anchor:)
        question = current_user.interview_question_sets.find(question_set_id).questions.find(question_id)
        payload_from(::InterviewPrep::StartQuestionTaskService.call(user: current_user, question: question, task_type: "generate_interview_memory_anchor", answer_text: answer_text, memory_anchor: memory_anchor), :ai_task)
      end
    end
  end
end
