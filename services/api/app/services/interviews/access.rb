# Checks access to user-owned spoken interviews and admission to the real runtime.
module Interviews
  module Access
    def self.enabled?
      true
    end

    def self.admission_enabled?
      enabled? && ENV["INTERVIEW_ADMISSION_ENABLED"] == "true"
    end

    def self.find!(user, id)
      check!(user)
      interview = user.interview_sessions.find(id)
      raise GraphQL::ExecutionError, "Interview expired" if interview.expires_at <= Time.current || interview.expired?
      interview
    end

    def self.check!(user)
      raise GraphQL::ExecutionError, "Authentication required" unless user
      raise GraphQL::ExecutionError, "Interviews unavailable in this environment" unless enabled?
    end
  end
end
