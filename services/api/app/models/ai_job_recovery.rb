# Retains an infrastructure retry budget when Solid Queue resets job counters.
class AiJobRecovery < ApplicationRecord
  validates :active_job_id, presence: true, uniqueness: true
  validates :recovery_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
