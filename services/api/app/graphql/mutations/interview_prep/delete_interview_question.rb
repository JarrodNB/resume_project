# Removes a single practice question after authorizing it through the signed-in user's set.
module Mutations
  module InterviewPrep
    class DeleteInterviewQuestion < Mutations::BaseMutation
      argument :question_set_id, ID, required: true
      argument :question_id, ID, required: true
      field :question, Types::InterviewQuestionType

      def resolve(question_set_id:, question_id:)
        question = current_user.interview_question_sets.find(question_set_id).questions.find(question_id)
        payload_from(::InterviewPrep::DeleteQuestionService.call(question: question), :question)
      end
    end
  end
end
