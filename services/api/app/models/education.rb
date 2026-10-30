# Description: Career library entry for a degree, bootcamp, or other education.
class Education < ApplicationRecord
  include ScreenedFields
  include MostRecentFirst
  include LibrarySizeLimit

  belongs_to :user

  library_size_limit :educations, TextLimits::MAX_EDUCATIONS, "You can save up to #{TextLimits::MAX_EDUCATIONS} education entries"

  validates :institution, presence: true
  validates :institution, :degree, :field_of_study, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
end
