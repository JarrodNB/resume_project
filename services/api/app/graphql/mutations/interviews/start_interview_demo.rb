# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class StartInterviewDemo < BaseDemoMutation
      argument :execution_mode, String, required: false, default_value: "real"
      argument :career_focus, String, required: false
      argument :setup, Types::InterviewSetupInput, required: false

      field :interview, Types::InterviewSessionType, null: true

      def resolve(execution_mode:, career_focus: nil, setup: nil)
        authorize_demo!
        payload_from(::Interviews::StartDemoService.call(user: current_user, execution_mode: execution_mode,
          career_focus: career_focus, setup: setup&.to_h), :interview)
      end
    end
  end
end
