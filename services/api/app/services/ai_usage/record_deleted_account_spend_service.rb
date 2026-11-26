# Description: Before an account is deleted, adds what its AI tasks and embedding requests cost
# to the anonymous daily totals in DeletedAccountAiSpend. The totals keep the day (UTC) and
# whether the spend counted toward the trial budget, and nothing that identifies the user.
# Runs in the same transaction as the deletion, so the spend is kept if and only if the account goes.
module AiUsage
  class RecordDeletedAccountSpendService < ApplicationService
    def initialize(user:)
      @user = user
    end

    def call
      totals = Hash.new { |hash, key| hash[key] = { cost: 0, requests: 0 } }
      add_rows(totals, @user.ai_tasks)
      add_rows(totals, @user.ai_embedding_requests)
      totals.each do |(spend_date, counts_toward_trial_budget), amount|
        DeletedAccountAiSpend.add(spend_date: spend_date, counts_toward_trial_budget: counts_toward_trial_budget,
                                  cost_microdollars: amount[:cost], request_count: amount[:requests])
      end
      success(totals.size)
    end

    private

    # Unknown costs are not counted, the same as in the daily caps.
    def add_rows(totals, relation)
      relation.group(Arel.sql("created_at::date"), :counts_toward_trial_budget)
              .pluck(Arel.sql("created_at::date"), :counts_toward_trial_budget, Arel.sql("COALESCE(SUM(cost_microdollars), 0)"), Arel.sql("COUNT(*)"))
              .each do |spend_date, counts, cost, requests|
        totals[[ spend_date, counts ]][:cost] += cost
        totals[[ spend_date, counts ]][:requests] += requests
      end
    end
  end
end
