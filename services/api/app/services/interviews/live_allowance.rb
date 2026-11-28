# How much live interview spend a user has left, and how much time a live session has left.
#
# The live limit is a hidden dollar budget of its own, separate from the hidden daily AI spend cap
# for everything else: a trial gets one budget for the whole trial, a paid plan a budget per UTC
# day, an ended plan none. It is counted from what the live sessions actually cost (their live
# bills' provider cost, which each heartbeat adds to), because silence costs almost nothing and a
# minute of fast back-and-forth costs much more. A bill with a model the price list doesn't know
# counts at a conservative cost per counted second instead. Like the other caps, no amount ever
# reaches the user: they see nothing until the limit, then a plain refusal or the interviewer's
# goodbye. A trial counts every connection created since the trial started. A paid day counts
# connections created since UTC midnight plus any connection that is still open or ended since
# midnight, so a session running across midnight counts fully toward the new day.
# Each live session also has a 25-minute counted clock (waiting at the coaching menu isn't
# counted), shared by all its connections, and each connection a hard wall-clock cap of 45 minutes
# after it was first claimed: the heartbeat then says wrap up (`time_limit`), and recovery ends a
# connection whose agent ignores that.
module Interviews
  module LiveAllowance
    SESSION_SECONDS = 25 * 60
    CONNECTION_WALL_CLOCK = 45.minutes
    WARNING_SECONDS = 2 * 60
    # A 10.5-minute live interview cost about US$0.32; a full 25 minutes may cost up to about US$1.
    TRIAL_MICRODOLLARS = 500_000 # US$0.50 for the whole trial
    PAID_DAILY_MICRODOLLARS = 1_000_000 # US$1.00 per UTC day
    # A new live room needs this much left (US$0.20), so it isn't cut off after a question or two.
    MIN_START_MICRODOLLARS = 200_000
    # Counted for a bill the price list can't price: about twice what a live minute usually costs.
    UNPRICED_MICRODOLLARS_PER_SECOND = 1_000
    TRIAL_USED = "You've used the live interview practice included in your trial. Subscribe to keep " \
      "practicing live, or start a turn-based interview.".freeze
    DAY_USED = "You've reached today's live interview limit. Try again tomorrow, or start a turn-based interview.".freeze

    # @return [Integer] live microdollars the user may still spend, never below zero
    def self.remaining_microdollars(user)
      plan = Billing::ResolvePlanService.call(user: user).value
      limit, connections = counted(user, plan)
      return 0 unless limit

      [ limit - spent_microdollars(connections), 0 ].max
    end

    # Why a new live room may not start (too little of the live budget left), or nil when it may.
    # The message never says how much was spent or is left.
    # @return [String, nil]
    def self.start_refusal(user)
      return nil if remaining_microdollars(user) >= MIN_START_MICRODOLLARS

      Billing::ResolvePlanService.call(user: user).value.paid? ? DAY_USED : TRIAL_USED
    end

    # True once a claimed connection has been open for the wall-clock cap.
    def self.wall_clock_passed?(connection, now: Time.current)
      connection.connected_at.present? && connection.connected_at <= now - CONNECTION_WALL_CLOCK
    end

    # @return [Integer] counted seconds left on this live session's 25-minute clock
    def self.session_seconds_left(interview)
      [ SESSION_SECONDS - interview.live_connections.sum(:billed_seconds), 0 ].max
    end

    # The plan's live budget and the connections it counts, or [nil, nil] for an ended plan.
    def self.counted(user, plan)
      connections = InterviewLiveConnection.joins(:interview_session).where(interview_sessions: { user_id: user.id })
      if plan.paid?
        midnight = Time.now.utc.beginning_of_day
        [ PAID_DAILY_MICRODOLLARS, connections.where("interview_live_connections.created_at >= :midnight OR " \
          "interview_live_connections.status <> 'ended' OR interview_live_connections.ended_at >= :midnight", midnight: midnight) ]
      elsif plan.trial?
        [ TRIAL_MICRODOLLARS, connections.where(interview_live_connections: { created_at: (plan.trial_ends_at - Billing::Trial::LENGTH).. }) ]
      else
        [ nil, nil ]
      end
    end
    private_class_method :counted

    # The live bills' known cost; a bill with an unpriced entry counts at least the conservative
    # per-second cost of its counted time.
    def self.spent_microdollars(connections)
      rows = connections.left_joins(:ai_task).pluck("interview_live_connections.billed_seconds", "ai_tasks.id", "ai_tasks.cost_microdollars")
      unpriced = AiUsageEntry.where(ai_task_id: rows.filter_map { |row| row[1] }, cost_microdollars: nil).distinct.pluck(:ai_task_id).to_set
      rows.sum do |billed_seconds, task_id, cost|
        unpriced.include?(task_id) ? [ cost.to_i, billed_seconds * UNPRICED_MICRODOLLARS_PER_SECOND ].max : cost.to_i
      end
    end
    private_class_method :spent_microdollars
  end
end
