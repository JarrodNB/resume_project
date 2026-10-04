# Description: One ordered section of a resume. `content` is a JSON snapshot copied from the
# career library and profile when tailoring (and possibly rewritten), so editing it never
# changes the library.
# Content shapes: contact => { full_name, email, phone, location, links }, summary => { text },
# experience / projects / education / skills => { items: [...] } (each item mirrors its
# career library record, with highlights inline for experiences).
# Index:
#   - SECTION_TYPES / section_type enum: contact, summary, experience, projects, education,
#     skills, custom
class ResumeSection < ApplicationRecord
  SECTION_TYPES = %w[contact summary experience projects education skills custom].freeze

  belongs_to :resume

  enum :section_type, SECTION_TYPES.index_with(&:itself), validate: true

  validates :title, presence: true
end
