# Description: Authorized interview practice operation delegated to a Rails service.
# Index:
#   - resolve: scopes records to the signed-in user and returns validation errors
module Mutations
  module InterviewPrep
    class DeleteInterviewQuestionSet < Mutations::BaseMutation
      argument :id, ID, required: true
      field :question_set, Types::InterviewQuestionSetType

      # Authorizes records before invoking the domain service.
      def resolve(id:)
        question_set = current_user.interview_question_sets.find(id)
        payload_from(::InterviewPrep::DeleteQuestionSetService.call(question_set: question_set), :question_set)
      end
    end
  end
end
