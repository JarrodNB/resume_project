# Description: A user's estimated AI spend this calendar month (UTC) against their budget.
# Spend is the sum of the costs the AI worker reported on the user's tasks created this month.
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

    def initialize(user:)
      @user = user
    end

    # Sums this month's task costs and resolves the user's budget.
    def call
      month_start = Time.now.utc.beginning_of_month
      tasks = @user.ai_tasks.where(created_at: month_start..)
      spent = tasks.sum(:cost_microdollars)
      incomplete = AiUsageAttempt.where(ai_task_id: tasks.select(:id), incomplete: true).count
      budget = @user.monthly_ai_budget_microdollars || DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS
      success(MonthlyAiUsage.new(spent_microdollars: spent, budget_microdollars: budget,
                                resets_at: month_start.next_month, incomplete_attempts: incomplete))
    end
  end
end
