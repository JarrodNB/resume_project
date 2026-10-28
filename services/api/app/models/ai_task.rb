# One logical unit of AI work and its outcome. Queue features publish it over SQS;
# interview execution links it to durable HTTP work without publishing a queue message.
# Prepared interview child tasks share only the root's hourly admission, never its bill
# or concurrency slot. Spoken tasks use an independent allowance; general AI tasks
# keep their own hourly admissions, budget and concurrency.
# Index:
#   - TASK_TYPES / task_type enum: rerank_job_listings, improve_library_entry, review_library_section, parse_resume, scrape_job, parse_job_posting, analyze_gaps,
#     tailor_resume, generate_interview_questions, regenerate_interview_question, review_interview_answer
#   - STATUSES / status enum: queued, needs_user_input, completed, failed
#   - source_file: the uploaded file a task reads (e.g. the resume for parse_resume)
#   - finished?: true once completed or failed (late usage is still counted)
#   - accepted?: true once the user has accepted the result into their data
#   - Historical generation columns are unused; per-attempt reports deduplicate billing.
#   - ai_usage_attempts: execution reports, including retry charges and unknown costs
#   - ai_task_outcomes: separate durable success/failure occurrences, including explicit retries
class AiTask < ApplicationRecord
  TASK_TYPES = %w[chat_reply rerank_job_listings improve_library_entry review_library_section parse_resume scrape_job parse_job_posting analyze_gaps tailor_resume
                  generate_study_guide generate_interview_questions regenerate_interview_question review_interview_answer interview_turn interview_speech interview_preparation interview_transcription interview_clarification interview_references].freeze
  STATUSES = %w[queued needs_user_input completed failed].freeze
  SPOKEN_INTERVIEW_TASK_TYPES = %w[interview_preparation interview_turn interview_speech interview_transcription interview_clarification interview_references].freeze

  belongs_to :user
  belongs_to :subject, polymorphic: true, optional: true
  has_one_attached :source_file
  has_many :ai_usage_attempts, dependent: :destroy
  has_many :ai_task_outcomes, dependent: :delete_all
  belongs_to :hourly_admission_task, class_name: "AiTask", optional: true
  attr_readonly :hourly_admission_task_id
  scope :hourly_admissions, -> { where(hourly_admission_task_id: nil) }
  scope :spoken_interview, -> { where(task_type: SPOKEN_INTERVIEW_TASK_TYPES) }
  scope :general_ai, -> { where.not(task_type: SPOKEN_INTERVIEW_TASK_TYPES) }
  validate :hourly_admission_matches_interview

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

  private

  def hourly_admission_matches_interview
    return unless hourly_admission_task_id

    root = hourly_admission_task
    unless root&.persisted? && root.hourly_admission_task_id.nil? && root.task_type == "interview_preparation" &&
        root.user_id == user_id && root.subject_type == "InterviewSession" && root.subject_id == subject_id &&
        subject_type == "InterviewSession" && %w[interview_turn interview_speech interview_transcription interview_clarification interview_references].include?(task_type)
      errors.add(:hourly_admission_task, "must be this interview's owned preparation admission")
    end
  end
end
