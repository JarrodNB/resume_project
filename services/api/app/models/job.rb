# Description: A structured job profile the user tracks through application stages.
# Index:
#   - STAGES / stage enum: unapplied, applied, interviewing, rejected, offer
#   - resumes: tailored resumes written for this job
#   - ai_tasks: AI tasks about this job (its scrape, gap analyses); kept when the job is
#     deleted, because their cost still counts toward the monthly AI budget
#   - latest_gap_analysis: the most recent analyze_gaps task
class Job < ApplicationRecord
  STAGES = %w[unapplied applied interviewing rejected offer].freeze

  belongs_to :user
  has_many :resumes, dependent: :nullify
  has_many :ai_tasks, as: :subject, dependent: :nullify

  enum :stage, STAGES.index_with(&:itself), validate: true

  validates :title, :company, presence: true

  # Returns the newest gap analysis task for this job, or nil.
  def latest_gap_analysis
    ai_tasks.analyze_gaps.order(created_at: :desc).first
  end
end
