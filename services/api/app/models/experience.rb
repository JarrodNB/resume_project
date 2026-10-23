# One employment block from the career library. Roles preserve its titles and dates;
# highlights belong to the block, with optional ownership by one of its roles.
class Experience < ApplicationRecord
  include MostRecentFirst
  include LibrarySizeLimit

  belongs_to :user
  has_many :highlights, -> { order(:position) },
           class_name: "ExperienceHighlight", dependent: :destroy, inverse_of: :experience
  has_many :roles, -> { order(:position) }, class_name: "ExperienceRole",
           dependent: :destroy, inverse_of: :experience, autosave: true

  library_size_limit :experiences, TextLimits::MAX_EXPERIENCES, "You can save up to #{TextLimits::MAX_EXPERIENCES} roles"

  validates :company, :title, presence: true
  validates :company, :title, :location, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
  validate :highlights_within_limit
  validate :roles_within_limit
  validates_associated :roles

  private

  def roles_within_limit
    total = roles.to_a.count { |role| !role.marked_for_destruction? }
    return if total <= TextLimits::MAX_ROLES_PER_EXPERIENCE

    errors.add(:roles, "can contain up to #{TextLimits::MAX_ROLES_PER_EXPERIENCE} titles")
  end

  # Rejects a role with more bullets than a resume section can hold. Uses the in-memory
  # target when it is loaded so unsaved bullets count and a query cannot drop them.
  def highlights_within_limit
    total = if highlights.loaded?
      highlights.target.count { |highlight| !highlight.marked_for_destruction? && !highlight.destroyed? }
    else
      highlights.count
    end
    return if total <= TextLimits::MAX_HIGHLIGHTS_PER_ROLE

    errors.add(:base, "You can save up to #{TextLimits::MAX_HIGHLIGHTS_PER_ROLE} bullets on a role")
  end
end
