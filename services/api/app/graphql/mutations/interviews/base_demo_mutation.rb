# Shared authorization for the development-only spoken interview operations.
module Mutations
  module Interviews
    class BaseDemoMutation < BaseMutation
      private

      def authorize_demo!
        ::Interviews::DemoAccess.check!(current_user)
      end

      def interview(id)
        ::Interviews::DemoAccess.find!(current_user, id)
      end

      def snapshot_result(result, session)
        { interview: result.success? ? session.reload : nil, errors: result.errors }
      end
    end
  end
end
