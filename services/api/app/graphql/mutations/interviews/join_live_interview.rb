# Lets the owner join the LiveKit room of a live interview. Returns the room address and a
# short-lived join token; the first join also starts the interview.
module Mutations
  module Interviews
    class JoinLiveInterview < BaseInterviewMutation
      argument :interview_id, ID, required: true
      field :url, String, null: true, description: "LiveKit server address the browser connects to."
      field :token, String, null: true, description: "Join token for this room only; expires after about ten minutes."
      field :room_name, String, null: true
      field :expires_at, GraphQL::Types::ISO8601DateTime, null: true
      field :interview, Types::InterviewSessionType, null: true

      def resolve(interview_id:)
        session = interview(interview_id)
        result = ::Interviews::JoinLiveService.call(interview: session)
        (result.success? ? result.value.merge(interview: session.reload) : {}).merge(error_fields_from(result))
      end
    end
  end
end
