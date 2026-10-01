# Description: Career library entry for a degree, bootcamp, or other education.
class Education < ApplicationRecord
  belongs_to :user

  validates :institution, presence: true
end
