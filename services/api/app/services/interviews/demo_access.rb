# Restricts the synthetic interview surface to explicitly enabled local development.
module Interviews
  module DemoAccess
    def self.enabled?
      Rails.env.development? && ENV["INTERVIEW_DEMO_ENABLED"] == "true"
    end

    def self.find!(user, id)
      check!(user)
      interview = user.interview_sessions.find(id)
      raise GraphQL::ExecutionError, "Interview expired" if interview.expires_at <= Time.current || interview.expired?
      interview
    end

    def self.check!(user)
      raise GraphQL::ExecutionError, "Authentication required" unless user
      raise GraphQL::ExecutionError, "Interview demo unavailable" unless enabled?
    end
  end
end
