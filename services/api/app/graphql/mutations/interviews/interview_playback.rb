# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class InterviewPlayback < BaseDemoMutation
      argument :interview_id, ID, required: true
      argument :message_id, ID, required: true
      field :playback, Types::InterviewPlaybackType, null: true

      def resolve(interview_id:, **args)
        session = interview(interview_id)
        payload_from(::Interviews::ReadMediaService.call(interview: session, **args), :playback)
      end
    end
  end
end
