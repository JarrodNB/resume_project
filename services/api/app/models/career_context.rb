# Description: A career context: a job requirement the user answered and chose to keep.
# Saved career context is embedded and shown to later gap analysis. The job's own response is separate.
# Index:
#   - job_gap_responses: responses that point at this context; unlinked, not deleted, with it
class CareerContext < ApplicationRecord
  belongs_to :user
  has_many :job_gap_responses, dependent: :nullify

  include LibrarySizeLimit

  library_size_limit :career_contexts, TextLimits::MAX_CAREER_CONTEXTS,
                     "You can save up to #{TextLimits::MAX_CAREER_CONTEXTS} notes"

  validates :requirement, :response, presence: true
  validates :requirement, uniqueness: { scope: :user_id }, length: { maximum: TextLimits::BULLET }
  validates :response, length: { maximum: TextLimits::PROSE }
end
