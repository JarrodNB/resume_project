# Description: One bullet point (accomplishment or responsibility) for an experience.
class ExperienceHighlight < ApplicationRecord
  belongs_to :experience

  validates :content, presence: true
end
