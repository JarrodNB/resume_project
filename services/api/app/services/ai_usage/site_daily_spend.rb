# Stops new trial-user AI work once the trial users' combined known spend today (UTC) reaches a
# site-wide limit, so a wave of fake signups can't run up an unbounded bill. Paying subscribers are
# never blocked by it, and their spend does not count toward the total.
# Counts general AI, spoken interviews and background embeddings, because all of them are billed.
# Embedding jobs are counted but never refused: they are derived data with no user waiting on them.
# The total is cached briefly because this runs under a lock on the user row, so it can overshoot
# by what's spent in CACHE_TTL. Unknown costs add nothing, the same as per-user daily caps.
module AiUsage
  module SiteDailySpend
    CACHE_TTL = 30.seconds

    def self.limit_reached?
      known_microdollars >= SITE_DAILY_AI_BUDGET_MICRODOLLARS
    end

    def self.known_microdollars
      day_start = Time.now.utc.beginning_of_day
      Rails.cache.fetch("ai_usage/site_daily_spend/#{day_start.to_date.iso8601}", expires_in: CACHE_TTL) do
        paying_users = BillingSubscription.paid.select(:user_id)
        AiTask.where(created_at: day_start..).where.not(user_id: paying_users).sum(:cost_microdollars) +
          AiEmbeddingRequest.where(created_at: day_start..).where.not(user_id: paying_users).sum(:cost_microdollars)
      end
    end
  end
end
