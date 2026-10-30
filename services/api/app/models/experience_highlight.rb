# Description: One bullet point (accomplishment or responsibility) for an experience.
class ExperienceHighlight < ApplicationRecord
  include ScreenedFields
  belongs_to :experience

  validates :content, presence: true, length: { maximum: TextLimits::BULLET }
end
