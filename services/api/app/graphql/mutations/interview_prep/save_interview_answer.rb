# Description: Authorized interview practice operation delegated to a Rails service.
# Index:
#   - resolve: scopes records to the signed-in user and returns validation errors
module Mutations
  module InterviewPrep
    class SaveInterviewAnswer < Mutations::BaseMutation
      argument :question_set_id, ID, required: true
      argument :question_id, ID, required: true
      argument :answer_text, String, required: true
      field :question, Types::InterviewQuestionType

      # Authorizes records before invoking the domain service.
      def resolve(question_set_id:, question_id:, answer_text:)
        question = current_user.interview_question_sets.find(question_set_id).questions.find(question_id)
        payload_from(::InterviewPrep::SaveAnswerService.call(question: question, answer_text: answer_text), :question)
      end
    end
  end
end
