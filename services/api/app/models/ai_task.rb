# Description: One unit of AI work sent to the worker over SQS, and its outcome.
# Index:
#   - TASK_TYPES / task_type enum: parse_resume, scrape_job, analyze_gaps, tailor_resume
#   - STATUSES / status enum: queued, needs_user_input, completed, failed
#   - source_file: the uploaded file a task reads (e.g. the resume for parse_resume)
#   - finished?: true once completed or failed (later results for it are ignored)
#   - accepted?: true once the user has accepted the result into their data
class AiTask < ApplicationRecord
  TASK_TYPES = %w[parse_resume scrape_job analyze_gaps tailor_resume].freeze
  STATUSES = %w[queued needs_user_input completed failed].freeze

  belongs_to :user
  belongs_to :subject, polymorphic: true, optional: true
  has_one_attached :source_file

  enum :task_type, TASK_TYPES.index_with(&:itself), validate: true
  enum :status, STATUSES.index_with(&:itself), validate: true

  # Returns true when no further results should be applied to this task.
  def finished?
    completed? || failed?
  end

  # Returns true when the result has already been accepted (e.g. imported).
  def accepted?
    accepted_at.present?
  end
end
