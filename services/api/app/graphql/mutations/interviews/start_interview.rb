# Starts durable spoken preparation, optionally for an owned saved job.
module Mutations
  module Interviews
    class StartInterview < BaseInterviewMutation
      argument :execution_mode, String, required: false, default_value: "real"
      argument :career_focus, String, required: false
      argument :setup, Types::InterviewSetupInput, required: false
      argument :job_id, ID, required: false
      argument :conversation_mode, String, required: false, default_value: "turn_based",
        description: "turn_based (default) or live; live allows 5 or 8 questions"

      field :interview, Types::InterviewSessionType, null: true

      def resolve(execution_mode:, conversation_mode:, career_focus: nil, setup: nil, job_id: nil)
        authorize_interview!
        job = current_user.jobs.find(job_id) unless job_id.nil?
        payload_from(::Interviews::StartSessionService.call(user: current_user, execution_mode: execution_mode,
          career_focus: career_focus, setup: setup&.to_h, job: job, conversation_mode: conversation_mode), :interview)
      end
    end
  end
end
