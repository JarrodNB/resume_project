# Description: Career library entry for a skill, optionally grouped by category.
class Skill < ApplicationRecord
  belongs_to :user

  validates :name, presence: true, uniqueness: { scope: :user_id, case_sensitive: false }
end
