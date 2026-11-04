# Stops new AI work once everyone's combined known spend today (UTC) reaches a site-wide limit,
# so many accounts each staying inside their own budget can't run up an unbounded bill.
# Counts general AI, spoken interviews and background embeddings, because all of them are billed.
# Embedding jobs are counted but never refused: they are derived data with no user waiting on them.
# The total is cached briefly because this runs under a lock on the user row, so it can overshoot
# by what's spent in CACHE_TTL. Unknown costs add nothing, the same as per-user budgets.
module AiUsage
  module SiteDailySpend
    CACHE_TTL = 30.seconds

    def self.limit_reached?
      known_microdollars >= SITE_DAILY_AI_BUDGET_MICRODOLLARS
    end

    def self.known_microdollars
      day_start = Time.now.utc.beginning_of_day
      Rails.cache.fetch("ai_usage/site_daily_spend/#{day_start.to_date.iso8601}", expires_in: CACHE_TTL) do
        AiTask.where(created_at: day_start..).sum(:cost_microdollars) +
          AiEmbeddingRequest.where(created_at: day_start..).sum(:cost_microdollars)
      end
    end
  end
end
