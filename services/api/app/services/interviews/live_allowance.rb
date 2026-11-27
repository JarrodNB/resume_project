# How much live interview time a user has left, and how much a live session has left.
#
# The live allowance is separate from the hidden daily AI spend cap: trial users get 10 minutes
# over the whole trial, paid users 60 minutes per UTC day, and an ended plan gets none. It is
# counted from the billed seconds of the user's live connections (time while the coaching menu
# waits for a choice is never billed). A trial counts every connection created since the trial
# started. A paid day counts connections created since UTC midnight plus any connection that is
# still open or ended since midnight, so a session running across midnight counts fully toward
# the new day, also after it ends.
# Each live session also has a 25-minute counted clock, shared by all its connections.
module Interviews
  module LiveAllowance
    SESSION_SECONDS = 25 * 60
    MIN_START_SECONDS = 5 * 60
    WARNING_SECONDS = 2 * 60
    TRIAL_SECONDS = 10 * 60
    PAID_DAILY_SECONDS = 60 * 60

    # @return [Integer] live seconds the user may still use, never below zero
    def self.remaining_seconds(user)
      plan = Billing::ResolvePlanService.call(user: user).value
      connections = InterviewLiveConnection.joins(:interview_session).where(interview_sessions: { user_id: user.id })
      limit, counted = if plan.paid?
        midnight = Time.now.utc.beginning_of_day
        [ PAID_DAILY_SECONDS, connections.where("interview_live_connections.created_at >= :midnight OR " \
          "interview_live_connections.status <> 'ended' OR interview_live_connections.ended_at >= :midnight", midnight: midnight) ]
      elsif plan.trial?
        [ TRIAL_SECONDS, connections.where(interview_live_connections: { created_at: (plan.trial_ends_at - Billing::Trial::LENGTH).. }) ]
      else
        return 0
      end
      [ limit - counted.sum(:billed_seconds), 0 ].max
    end

    # Why a new live room may not start (fewer than 5 minutes left), or nil when it may.
    # @return [String, nil]
    def self.start_refusal(user)
      seconds = remaining_seconds(user)
      return nil if seconds >= MIN_START_SECONDS

      minutes = seconds / 60
      "You need at least #{MIN_START_SECONDS / 60} live minutes to start a live interview. " \
        "You have #{minutes} #{minutes == 1 ? 'minute' : 'minutes'} left."
    end

    # @return [Integer] counted seconds left on this live session's 25-minute clock
    def self.session_seconds_left(interview)
      [ SESSION_SECONDS - interview.live_connections.sum(:billed_seconds), 0 ].max
    end
  end
end
