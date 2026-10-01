# Description: One ordered section of a resume. `content` is a JSON snapshot copied from the
# career library (and possibly rewritten), so editing it never changes the library.
# Index:
#   - SECTION_TYPES / section_type enum: summary, experience, projects, education, skills, custom
class ResumeSection < ApplicationRecord
  SECTION_TYPES = %w[summary experience projects education skills custom].freeze

  belongs_to :resume

  enum :section_type, SECTION_TYPES.index_with(&:itself), validate: true

  validates :title, presence: true
end
