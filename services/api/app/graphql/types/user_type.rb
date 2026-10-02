# frozen_string_literal: true

# Description: The signed-in user.
# Index:
#   - id, email, name
#   - ai_usage: this month's estimated AI spend and budget
module Types
  class UserType < Types::BaseObject
    field :id, ID, null: false
    field :email, String, null: false
    field :name, String
    field :ai_usage, Types::AiUsageType, null: false

    # Summarizes the user's AI spend this month. Only reachable through `me`, so it's always the
    # signed-in user.
    def ai_usage = AiUsage::SummarizeMonthlyAiUsageService.call(user: object).value
  end
end
