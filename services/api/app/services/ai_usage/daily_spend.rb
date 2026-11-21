# One user's known AI spend today (UTC), used to enforce their hidden daily spend cap.
# Adds general AI tasks, spoken interview tasks and background embedding receipts, because all of
# them are billed to the same cap. Unknown costs add nothing, so the total only counts known charges.
# Embedding receipts are counted here but never refused: no user is waiting on them.
module AiUsage
  module DailySpend
    def self.known_microdollars(user)
      day_start = Time.now.utc.beginning_of_day
      user.ai_tasks.where(created_at: day_start..).sum(:cost_microdollars) +
        user.ai_embedding_requests.where(created_at: day_start..).sum(:cost_microdollars)
    end
  end
end
