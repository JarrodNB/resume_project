# An assessment run retains the exact saved inputs even after later edits.
class AtsCheckRun < ApplicationRecord
  belongs_to :user
  belongs_to :resume
  belongs_to :ai_task, optional: true
  attr_readonly :user_id, :resume_id, :content_snapshot, :job_snapshot,
                :content_fingerprint, :job_fingerprint, :rubric_version
  validates :status, inclusion: { in: %w[pending queued completed failed] }
end
