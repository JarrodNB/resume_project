# Lower AI limits for an account's first week after verifying email, so a batch of fake accounts
# costs less. Budgets and hourly starts only; a user's override columns still win over these.
# Index:
#   - PERIOD: how long an account counts as new
#   - ends_at: when the lower limits end, or nil for an established account
#   - general_monthly_budget, ai_tasks_per_hour, interview_monthly_budget, interview_sessions_per_hour
module AiUsage
  module NewAccountLimits
    PERIOD = 7.days

    # An account that never verified has no established history, so it counts as new.
    def self.new_account?(user)
      user.confirmed_at.nil? || user.confirmed_at > PERIOD.ago
    end

    def self.ends_at(user)
      (user.confirmed_at || Time.current) + PERIOD if new_account?(user)
    end

    def self.general_monthly_budget(user)
      limit_for(user, DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS, NEW_ACCOUNT_MONTHLY_AI_BUDGET_MICRODOLLARS)
    end

    def self.ai_tasks_per_hour(user)
      limit_for(user, DEFAULT_AI_TASKS_PER_HOUR, NEW_ACCOUNT_AI_TASKS_PER_HOUR)
    end

    def self.interview_monthly_budget(user)
      limit_for(user, DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS, NEW_ACCOUNT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS)
    end

    def self.interview_sessions_per_hour(user)
      limit_for(user, DEFAULT_INTERVIEW_SESSIONS_PER_HOUR, NEW_ACCOUNT_INTERVIEW_SESSIONS_PER_HOUR)
    end

    # Never raises a limit: an operator may have set the default below the new-account value.
    def self.limit_for(user, default, new_account)
      new_account?(user) ? [ default, new_account ].min : default
    end
    private_class_method :limit_for
  end
end
