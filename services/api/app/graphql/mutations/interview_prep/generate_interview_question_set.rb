# Description: Authorized interview practice operation delegated to a Rails service.
# Index:
#   - resolve: scopes records to the signed-in user and returns validation errors
module Mutations
  module InterviewPrep
    class GenerateInterviewQuestionSet < Mutations::BaseMutation
      field :ai_task, Types::AiTaskType

      # Authorizes records before invoking the domain service.
      def resolve
        payload_from(::InterviewPrep::StartQuestionSetService.call(user: current_user), :ai_task)
      end
    end
  end
end
