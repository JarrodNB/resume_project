# Description: One bullet point (accomplishment or responsibility) for an experience.
class ExperienceHighlight < ApplicationRecord
  include ScreenedFields
  screenable_fields %w[content]
  belongs_to :experience

  validates :content, presence: true, length: { maximum: TextLimits::BULLET }
end
