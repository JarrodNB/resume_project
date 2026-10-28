# Shared authorization for owner-scoped spoken interview operations.
module Mutations
  module Interviews
    class BaseInterviewMutation < BaseMutation
      private

      def authorize_interview!
        ::Interviews::Access.check!(current_user)
      end

      def interview(id)
        ::Interviews::Access.find!(current_user, id)
      end

      def snapshot_result(result, session)
        { interview: result.success? ? session.reload : nil, errors: result.errors }
      end
    end
  end
end
