# A title held within one experience entry. Its position preserves the source order;
# bullets stay owned by the experience and can optionally point to this role.
class ExperienceRole < ApplicationRecord
  belongs_to :experience, inverse_of: :roles
  has_many :highlights, class_name: "ExperienceHighlight", dependent: :restrict_with_error

  validates :title, presence: true, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0,
                                     less_than: TextLimits::MAX_ROLES_PER_EXPERIENCE }
end
