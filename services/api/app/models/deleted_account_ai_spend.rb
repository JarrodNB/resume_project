# Description: Daily totals of AI spend from accounts that were later deleted. A row holds only a
# date, whether the spend counted toward the trial budget, the known cost and the number of
# requests: no user, no task and no content. It exists so deleting an account does not erase
# the spend that the site-wide daily budget is meant to count.
class DeletedAccountAiSpend < ApplicationRecord
  validates :spend_date, presence: true
  validates :cost_microdollars, :request_count, numericality: { greater_than_or_equal_to: 0 }

  # Adds to the total for one day and budget class, creating it the first time. Safe when two
  # accounts are deleted at once: the database adds the amounts.
  def self.add(spend_date:, counts_toward_trial_budget:, cost_microdollars:, request_count:)
    now = Time.current
    upsert({ spend_date: spend_date, counts_toward_trial_budget: counts_toward_trial_budget,
             cost_microdollars: cost_microdollars, request_count: request_count, created_at: now, updated_at: now },
           unique_by: :index_deleted_account_ai_spends_on_day_and_budget, on_duplicate: Arel.sql(
             "cost_microdollars = deleted_account_ai_spends.cost_microdollars + EXCLUDED.cost_microdollars, " \
             "request_count = deleted_account_ai_spends.request_count + EXCLUDED.request_count, updated_at = EXCLUDED.updated_at"
           ))
  end
end
