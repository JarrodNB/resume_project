# One candidate join of a live interview's LiveKit room. Rails authorizes it; the live agent
# later marks it connected, reports billed seconds and provider usage in heartbeats (applied once
# each by `heartbeat_sequence`) and ends it. A session has at most one
# connection that is not ended, and a repeat join reuses it.
class InterviewLiveConnection < ApplicationRecord
  STATUSES = %w[authorized connected ended].freeze
  END_REASONS = %w[completed time_limit allowance ended_by_candidate disconnected failed idle].freeze
  belongs_to :interview_session
  belongs_to :ai_task, optional: true # the connection's live conversation bill, opened when the agent claims it
  scope :open, -> { where.not(status: "ended") }
  validates :room_name, presence: true
  validates :status, inclusion: { in: STATUSES }
  validates :end_reason, inclusion: { in: END_REASONS }, allow_nil: true
  validates :billed_seconds, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
