# Description: A structured job profile the user tracks through application stages.
# The title is required; company may be unknown and stored as null. Imported jobs keep
# an optional catalogue identity; their editable fields remain private snapshots.
# Index:
#   - STAGES / stage enum: unapplied, applied, interviewing, rejected, offer
#   - resumes: tailored resumes written for this job
#   - interview_sessions: spoken practice kept with its frozen context after job deletion
#   - ai_tasks: AI tasks about this job (its scrape, gap analyses); kept when the job is
#     deleted, because their cost still counts toward the monthly AI budget
#   - gap_responses: the user's answers to this job's requirements, keyed by requirement text
#   - latest_gap_analysis: the most recent analyze_gaps task
#   - latest_tailoring: the most recent tailor_resume task
class Job < ApplicationRecord
  include ScreenedFields
  scope :active, -> { where(archived_at: nil) }

  STAGES = %w[unapplied applied interviewing rejected offer].freeze

  belongs_to :user
  belongs_to :job_board_listing, optional: true
  has_many :resumes, dependent: :nullify
  has_many :interview_sessions, dependent: :nullify
  has_many :ai_tasks, as: :subject, dependent: :nullify
  has_many :gap_responses, -> { order(:created_at) }, class_name: "JobGapResponse", dependent: :destroy, inverse_of: :job

  enum :stage, STAGES.index_with(&:itself), validate: true

  validates :title, presence: true
  validates :title, :company, :location, :url, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::JOB_DESCRIPTION }
  validates :notes, length: { maximum: TextLimits::PROSE }
  validate :requirement_lists_within_limits

  # Returns the newest gap analysis task for this job, or nil.
  def latest_gap_analysis
    ai_tasks.analyze_gaps.order(created_at: :desc).first
  end

  # Returns the newest tailor_resume task for this job, or nil.
  def latest_tailoring
    ai_tasks.tailor_resume.order(created_at: :desc).first
  end

  private

  # Caps how many requirements each list holds and how long each item is.
  def requirement_lists_within_limits
    limit_list(:requirements, "requirement", "requirements")
    limit_list(:responsibilities, "responsibility", "responsibilities")
    limit_list(:nice_to_haves, "nice-to-have", "nice-to-haves")
  end

  # Adds a base error when the list is too long or an item exceeds a bullet.
  def limit_list(attribute, singular, plural)
    values = public_send(attribute)
    unless values.is_a?(Array)
      errors.add(attribute, "must be a list")
      return
    end

    if values.size > TextLimits::MAX_REQUIREMENTS
      errors.add(:base, "You can save up to #{TextLimits::MAX_REQUIREMENTS} #{plural}")
    end
    return unless values.any? { |item| item.to_s.length > TextLimits::BULLET }

    errors.add(:base, "A #{singular} is too long (maximum is #{TextLimits::BULLET} characters)")
  end
end
