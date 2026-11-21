# Checks access to user-owned spoken interviews.
module Interviews
  module Access
    def self.find!(user, id)
      check!(user)
      interview = user.interview_sessions.find(id)
      raise GraphQL::ExecutionError, "Interview expired" if interview.expires_at <= Time.current || interview.expired?
      interview
    end

    def self.check!(user)
      raise GraphQL::ExecutionError, "Authentication required" unless user
    end
  end
end
