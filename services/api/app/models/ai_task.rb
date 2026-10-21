# One logical unit of AI work and its outcome. Queue features publish it over SQS;
# interview execution links it to durable HTTP work without publishing a queue message.
# Index:
#   - TASK_TYPES / task_type enum: parse_resume, scrape_job, parse_job_posting, analyze_gaps,
#     tailor_resume, generate_interview_questions, regenerate_interview_question, review_interview_answer
#   - STATUSES / status enum: queued, needs_user_input, completed, failed
#   - source_file: the uploaded file a task reads (e.g. the resume for parse_resume)
#   - finished?: true once completed or failed (late usage is still counted)
#   - accepted?: true once the user has accepted the result into their data
#   - Historical generation columns are unused; per-attempt reports deduplicate billing.
#   - ai_usage_attempts: execution reports, including retry charges and unknown costs
class AiTask < ApplicationRecord
  TASK_TYPES = %w[parse_resume scrape_job parse_job_posting analyze_gaps tailor_resume
                  generate_interview_questions regenerate_interview_question review_interview_answer interview_turn interview_speech interview_preparation].freeze
  STATUSES = %w[queued needs_user_input completed failed].freeze

  belongs_to :user
  belongs_to :subject, polymorphic: true, optional: true
  has_one_attached :source_file
  has_many :ai_usage_attempts, dependent: :destroy

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
