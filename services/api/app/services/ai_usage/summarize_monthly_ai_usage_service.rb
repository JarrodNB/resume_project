# Description: A user's estimated AI spend this calendar month (UTC) against their budget.
# Spend includes worker task costs and Rails embedding requests created this month.
# Index:
#   - MonthlyAiUsage: spent_microdollars, budget_microdollars, resets_at, exhausted?
#   - call: returns a MonthlyAiUsage for the user
module AiUsage
  class SummarizeMonthlyAiUsageService < ApplicationService
    MonthlyAiUsage = Data.define(:spent_microdollars, :budget_microdollars, :resets_at) do
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
      spent = @user.ai_tasks.where(created_at: month_start..).sum(:cost_microdollars)
      spent += @user.embedding_usages.where(created_at: month_start..).sum(:cost_microdollars)
      budget = @user.monthly_ai_budget_microdollars || DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS
      success(MonthlyAiUsage.new(spent_microdollars: spent, budget_microdollars: budget, resets_at: month_start.next_month))
    end
  end
end
