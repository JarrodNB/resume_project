# Description: Career library entry for a role the user has held.
# Index:
#   - highlights: ordered bullet points for this role
class Experience < ApplicationRecord
  belongs_to :user
  has_many :highlights, -> { order(:position) },
           class_name: "ExperienceHighlight", dependent: :destroy, inverse_of: :experience

  validates :company, :title, presence: true
end
