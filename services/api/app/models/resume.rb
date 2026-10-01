# Description: A resume document built from the career library. Base resumes have no job;
# tailored resumes belong to the job they were written for.
# Index:
#   - KINDS / kind enum: base, tailored
#   - sections: ordered sections with JSON content snapshots
class Resume < ApplicationRecord
  KINDS = %w[base tailored].freeze

  belongs_to :user
  belongs_to :job, optional: true
  has_many :sections, -> { order(:position) },
           class_name: "ResumeSection", dependent: :destroy, inverse_of: :resume

  enum :kind, KINDS.index_with(&:itself), validate: true

  validates :title, presence: true
  validates :job, presence: true, if: :tailored?
end
