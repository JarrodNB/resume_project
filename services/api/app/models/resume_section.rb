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

  validates :title, presence: true, length: { maximum: TextLimits::SHORT }
  validate :content_within_text_limit

  private

  # Rejects a section whose strings would be too long to screen or to store on a task.
  def content_within_text_limit
    return unless TextLimits.section_too_long?(content)

    errors.add(:base, TextLimits::SECTION_TOO_LONG)
  end
end
