# frozen_string_literal: true

# Description: The signed-in user's combined AI spend and allowances this month. The
# object is an AiUsage::SummarizeMonthlyAiUsageService::MonthlyAiUsage.
# Index:
#   - spent_this_month_usd, monthly_budget_usd, resets_at
module Types
  class AiUsageType < Types::BaseObject
    MICRODOLLARS_PER_DOLLAR = 1_000_000.0

    field :spent_this_month_usd, Float, null: false, description: "Estimated cost of this month's AI tasks, including spoken interviews."
    field :monthly_budget_usd, Float, null: false, description: "Sum of the separate general AI and spoken interview monthly allowances."
    field :incomplete_attempts, Integer, null: false, description: "Executions or embedding requests with unresolved costs. Spend includes only known charges."
    field :accounting_complete, Boolean, null: false, description: "Whether every recorded request in this month has known costs."
    field :resets_at, GraphQL::Types::ISO8601DateTime, null: false, description: "Start of next month (UTC)."

    # Converts this month's spend to dollars.
    def spent_this_month_usd = object.spent_microdollars / MICRODOLLARS_PER_DOLLAR

    # Converts the budget to dollars.
    def monthly_budget_usd = object.budget_microdollars / MICRODOLLARS_PER_DOLLAR

    def accounting_complete = object.incomplete_attempts.zero?
  end
end
