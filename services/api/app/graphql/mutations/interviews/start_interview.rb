# Starts durable spoken preparation, optionally for an owned saved job. With `fromInterviewId` it
# starts a turn-based interview with the same setup, saved job and career focus as that owned
# interview instead (Rails copies them), as the live room's turn-based fallback does. Any other
# setting sent with it (career focus, setup, job, a live conversation or a non-real execution mode)
# is refused rather than silently dropped.
module Mutations
  module Interviews
    class StartInterview < BaseInterviewMutation
      argument :execution_mode, String, required: false, default_value: "real"
      argument :career_focus, String, required: false
      argument :setup, Types::InterviewSetupInput, required: false
      argument :job_id, ID, required: false
      argument :conversation_mode, Types::ConversationModeEnum, required: false, default_value: "turn_based",
        description: "TURN_BASED (default) or LIVE; live always has 5 questions"
      argument :from_interview_id, ID, required: false,
        description: "An owned interview whose setup, saved job and career focus a new turn-based interview copies. " \
          "Send no other settings with it: career focus, setup, job, a LIVE conversation mode or a non-real execution mode is refused."

      field :interview, Types::InterviewSessionType, null: true

      def resolve(execution_mode:, conversation_mode:, career_focus: nil, setup: nil, job_id: nil, from_interview_id: nil)
        authorize_interview!
        if from_interview_id
          mixed = [ career_focus, setup, job_id ].any? || conversation_mode != "turn_based" || execution_mode != "real"
          return start_from(from_interview_id, mixed: mixed)
        end
        job = current_user.jobs.find(job_id) unless job_id.nil?
        payload_from(::Interviews::StartSessionService.call(user: current_user, execution_mode: execution_mode,
          career_focus: career_focus, setup: setup&.to_h, job: job, conversation_mode: conversation_mode), :interview)
      end

      private

      def start_from(interview_id, mixed:)
        if mixed
          return { interview: nil, errors: [ "Start from an earlier interview or with new settings, not both" ], error_code: nil }
        end

        source = current_user.interview_sessions.find(interview_id)
        payload_from(::Interviews::StartFromInterviewService.call(user: current_user, source: source), :interview)
      end
    end
  end
end
