# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class StartInterviewDemo < BaseDemoMutation
      argument :execution_mode, String, required: false, default_value: "fake"

      field :interview, Types::InterviewSessionType, null: true

      def resolve(execution_mode:)
        authorize_demo!
        payload_from(::Interviews::StartDemoService.call(user: current_user, execution_mode: execution_mode), :interview)
      end
    end
  end
end
