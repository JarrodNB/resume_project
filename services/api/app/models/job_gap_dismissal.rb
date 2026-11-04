# Description: The user's choice not to answer one requirement of one job, because it doesn't
# apply or they can't or don't want to answer. Keyed by the requirement text, so it survives
# re-running the comparison. Only the Fit tab reads it: it never reaches AI prompts.
class JobGapDismissal < ApplicationRecord
  belongs_to :job

  validates :requirement, presence: true, uniqueness: { scope: :job_id }, length: { maximum: TextLimits::BULLET }
end
