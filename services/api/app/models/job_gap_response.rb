# Description: The user's answer to one requirement of one job. Keyed by the requirement text,
# so it survives re-running the comparison. Optional link to the career context created from it.
class JobGapResponse < ApplicationRecord
  include ScreenedFields
  screenable_fields %w[requirement body]
  belongs_to :job
  belongs_to :career_context, optional: true

  validates :requirement, :body, presence: true
  validates :requirement, uniqueness: { scope: :job_id }, length: { maximum: TextLimits::BULLET }
  validates :body, length: { maximum: TextLimits::PROSE }
end
