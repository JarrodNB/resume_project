# Starts durable spoken preparation, optionally for an owned saved job. With `fromInterviewId` it
# starts with the same setup, saved job and career focus as that owned interview instead (Rails
# copies them), as the live room's turn-based fallback does.
module Mutations
  module Interviews
    class StartInterview < BaseInterviewMutation
      argument :execution_mode, String, required: false, default_value: "real"
      argument :career_focus, String, required: false
      argument :setup, Types::InterviewSetupInput, required: false
      argument :job_id, ID, required: false
      argument :conversation_mode, Types::ConversationModeEnum, required: false, default_value: "turn_based",
        description: "TURN_BASED (default) or LIVE; live allows 5 or 8 questions"
      argument :from_interview_id, ID, required: false,
        description: "An owned interview whose setup, saved job and career focus the new one copies; not combined with the other settings."

      field :interview, Types::InterviewSessionType, null: true

      def resolve(execution_mode:, conversation_mode:, career_focus: nil, setup: nil, job_id: nil, from_interview_id: nil)
        authorize_interview!
        return start_from(from_interview_id, conversation_mode, mixed: [ career_focus, setup, job_id ].any?) if from_interview_id
        job = current_user.jobs.find(job_id) unless job_id.nil?
        payload_from(::Interviews::StartSessionService.call(user: current_user, execution_mode: execution_mode,
          career_focus: career_focus, setup: setup&.to_h, job: job, conversation_mode: conversation_mode), :interview)
      end

      private

      def start_from(interview_id, conversation_mode, mixed:)
        if mixed
          return { interview: nil, errors: [ "Start from an earlier interview or with new settings, not both" ], error_code: nil }
        end

        source = current_user.interview_sessions.find(interview_id)
        payload_from(::Interviews::StartFromInterviewService.call(user: current_user, source: source, conversation_mode: conversation_mode), :interview)
      end
    end
  end
end
