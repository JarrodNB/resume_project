# Save one candidate-written question directly into the authenticated user's bank.
module Mutations
  module InterviewPrep
    class CreateCustomInterviewQuestion < Mutations::BaseMutation
      field :question_set, Types::InterviewQuestionSetType
      argument :set_type, Types::InterviewQuestionSetTypeEnum, required: true
      argument :question_text, String, required: true
      argument :answer_text, String, required: false, default_value: ""

      def resolve(set_type:, question_text:, answer_text:)
        payload_from(::InterviewPrep::CreateCustomQuestionService.call(user: current_user,
          set_type: set_type, question_text: question_text, answer_text: answer_text), :question_set)
      end
    end
  end
end
