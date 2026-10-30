# Description: Career library entry for a personal, open source, or work project.
class Project < ApplicationRecord
  include ScreenedFields
  screenable_fields %w[name role description]
  include MostRecentFirst
  include LibrarySizeLimit

  belongs_to :user

  library_size_limit :projects, TextLimits::MAX_PROJECTS, "You can save up to #{TextLimits::MAX_PROJECTS} projects"

  validates :name, presence: true
  validates :name, :role, :url, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
end
