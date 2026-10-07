# Description: Career library entry for a skill, optionally grouped by category.
class Skill < ApplicationRecord
  include LibrarySizeLimit

  belongs_to :user

  library_size_limit :skills, TextLimits::MAX_SKILLS, "You can save up to #{TextLimits::MAX_SKILLS} skills"

  validates :name, presence: true, uniqueness: { scope: :user_id, case_sensitive: false }
  validates :name, :category, length: { maximum: TextLimits::SHORT }
end
