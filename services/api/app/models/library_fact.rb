# Description: A career-library fact: a job requirement the user answered and chose to keep.
# Only facts are embedded and shown to later gap analysis. The job's own response is separate.
# Index:
#   - job_gap_responses: responses that point at this fact; unlinked, not deleted, with it
class LibraryFact < ApplicationRecord
  belongs_to :user
  has_many :job_gap_responses, dependent: :nullify

  include LibrarySizeLimit

  library_size_limit :library_facts, TextLimits::MAX_LIBRARY_FACTS,
                     "You can save up to #{TextLimits::MAX_LIBRARY_FACTS} notes"

  validates :requirement, :response, presence: true
  validates :requirement, uniqueness: { scope: :user_id }, length: { maximum: TextLimits::BULLET }
  validates :response, length: { maximum: TextLimits::PROSE }
end
