# A user's estimated spend across all AI tasks created this calendar month (UTC).
# Reporting combines general AI and spoken interviews. Admission checks select one
# allowance explicitly so independent limits do not split the user's total cost.
# Index:
#   - MonthlyAiUsage: known spend, budget, reset, incomplete_attempts, exhausted?
#   - call: returns a MonthlyAiUsage for the user
module AiUsage
  class SummarizeMonthlyAiUsageService < ApplicationService
    MonthlyAiUsage = Data.define(:spent_microdollars, :budget_microdollars, :resets_at, :incomplete_attempts) do
      # Returns true once no budget is left for new tasks.
      def exhausted?
        spent_microdollars >= budget_microdollars
      end
    end

    def initialize(user:, scope: :all)
      @user, @scope = user, scope
    end

    # Sums this month's task costs and resolves the user's budget.
    def call
      month_start = Time.now.utc.beginning_of_month
      tasks, budget = case @scope
      when :all
        [ @user.ai_tasks, general_budget + DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS ]
      when :general
        [ @user.ai_tasks.general_ai, general_budget ]
      when :interview
        [ @user.ai_tasks.spoken_interview, DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS ]
      else
        raise ArgumentError, "Unknown AI usage scope: #{@scope.inspect}"
      end
      tasks = tasks.where(created_at: month_start..)
      spent = tasks.sum(:cost_microdollars)
      incomplete = AiUsageAttempt.where(ai_task_id: tasks.select(:id), incomplete: true).count
      unless @scope == :interview
        embeddings = @user.ai_embedding_requests.where(created_at: month_start..)
        spent += embeddings.sum(:cost_microdollars)
        incomplete += embeddings.where(incomplete: true).count
      end
      success(MonthlyAiUsage.new(spent_microdollars: spent, budget_microdollars: budget,
                                resets_at: month_start.next_month, incomplete_attempts: incomplete))
    end

    private

    def general_budget
      @user.monthly_ai_budget_microdollars || DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS
    end
  end
end
