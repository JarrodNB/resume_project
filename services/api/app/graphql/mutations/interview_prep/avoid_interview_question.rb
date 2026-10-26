# Authorize a written question before saving the user's shared interview preference.
module Mutations
  module InterviewPrep
    class AvoidInterviewQuestion < Mutations::BaseMutation
      argument :question_set_id, ID, required: true
      argument :question_id, ID, required: true
      argument :expected_revision, Integer, required: true
      field :saved, Boolean, null: false

      def resolve(question_set_id:, question_id:, expected_revision:)
        question = current_user.interview_question_sets.find(question_set_id).questions.find(question_id)
        result = ::InterviewPrep::AvoidQuestionService.call(user: current_user, question: question, expected_revision: expected_revision)
        { saved: result.success?, errors: result.errors }
      end
    end
  end
end
