# One stable bullet owned by an experience, optionally scoped to one of its roles.
# A missing role means the bullet is shared across the experience.
class ExperienceHighlight < ApplicationRecord
  belongs_to :experience
  belongs_to :experience_role, optional: true

  validates :content, presence: true, length: { maximum: TextLimits::BULLET }
  validate :role_belongs_to_experience

  private

  def role_belongs_to_experience
    return unless experience_role && experience_role.experience != experience

    errors.add(:experience_role, "must belong to the same experience")
  end
end
