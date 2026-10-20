# Exposes one owned demo action through the existing durable interview services.
module Mutations
  module Interviews
    class StartInterviewDemo < BaseDemoMutation
      field :interview, Types::InterviewSessionType, null: true

      def resolve
        authorize_demo!
        payload_from(::Interviews::CreateFixtureService.call(user: current_user), :interview)
      end
    end
  end
end
