# frozen_string_literal: true

# Description: The signed-in user's estimated AI spend this month against their budget. The
# object is an AiUsage::SummarizeMonthlyAiUsageService::MonthlyAiUsage.
# Index:
#   - spent_this_month_usd, monthly_budget_usd, resets_at, incomplete_attempts
module Types
  class AiUsageType < Types::BaseObject
    MICRODOLLARS_PER_DOLLAR = 1_000_000.0

    field :spent_this_month_usd, Float, null: false, description: "Estimated LLM cost of this month's AI tasks."
    field :monthly_budget_usd, Float, null: false
    field :incomplete_attempts, Integer, null: false, description: "Executions with missing provider usage or pricing; spend may be higher."
    field :resets_at, GraphQL::Types::ISO8601DateTime, null: false, description: "Start of next month (UTC)."

    # Converts this month's spend to dollars.
    def spent_this_month_usd = object.spent_microdollars / MICRODOLLARS_PER_DOLLAR

    # Converts the budget to dollars.
    def monthly_budget_usd = object.budget_microdollars / MICRODOLLARS_PER_DOLLAR
  end
end
