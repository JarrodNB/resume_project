# One user's known AI spend today (UTC), used only to enforce their hidden daily spend cap.
# Adds general AI tasks, spoken interview tasks and background embedding receipts, because all of
# them are billed to the same cap. Unknown costs add nothing, so the total only counts known charges.
# Embedding receipts are counted here but never refused: no user is waiting on them.
# Live conversation tasks are left out: the live allowance is live mode's only limit, so a live
# session never uses up the cap for other AI work. Their costs stay on the tasks and the ledger for
# cost reports, and still count toward the site-wide trial budget (SiteDailySpend).
module AiUsage
  module DailySpend
    def self.known_microdollars(user)
      day_start = Time.now.utc.beginning_of_day
      user.ai_tasks.where(created_at: day_start..).where.not(task_type: AiTask::LIVE_BILL_TASK_TYPES).sum(:cost_microdollars) +
        user.ai_embedding_requests.where(created_at: day_start..).sum(:cost_microdollars)
    end
  end
end
