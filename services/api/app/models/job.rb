# Description: A structured job profile the user tracks through application stages.
# Index:
#   - STAGES / stage enum: unapplied, applied, interviewing, rejected, offer
#   - resumes: tailored resumes written for this job
class Job < ApplicationRecord
  STAGES = %w[unapplied applied interviewing rejected offer].freeze

  belongs_to :user
  has_many :resumes, dependent: :nullify

  enum :stage, STAGES.index_with(&:itself), validate: true

  validates :title, :company, presence: true
end
