# Description: The user's answer to one requirement of one job. Keyed by the requirement text,
# so it survives re-running the comparison. Optional link to the library fact created from it.
class JobGapResponse < ApplicationRecord
  belongs_to :job
  belongs_to :library_fact, optional: true

  validates :requirement, :body, presence: true
  validates :requirement, uniqueness: { scope: :job_id }, length: { maximum: TextLimits::BULLET }
  validates :body, length: { maximum: TextLimits::PROSE }
end
