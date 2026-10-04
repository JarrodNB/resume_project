# Description: Career library entry for a degree, bootcamp, or other education.
class Education < ApplicationRecord
  include MostRecentFirst

  belongs_to :user

  validates :institution, presence: true
end
