# One employment block from the career library. Roles preserve its titles and dates;
# highlights belong to the block, with optional ownership by one of its roles.
class Experience < ApplicationRecord
  # Retained database columns are inert during the deploy transition. Never read or
  # write them: legacy request adapters populate roles before saving.
  self.ignored_columns += %w[title start_date end_date]

  include MostRecentFirst
  include LibrarySizeLimit

  belongs_to :user
  has_many :highlights, -> { order(:position) },
           class_name: "ExperienceHighlight", dependent: :destroy, inverse_of: :experience
  has_many :roles, -> { order(:position) }, class_name: "ExperienceRole",
           dependent: :destroy, inverse_of: :experience, autosave: true

  # Compare canonical role dates independently of their source order.
  scope :most_recent_first, -> {
    role_query = "FROM experience_roles WHERE experience_id = experiences.id ORDER BY #{MostRecentFirst::ORDER_SQL} LIMIT 1"
    start_date = "(SELECT start_date #{role_query})"
    end_date = "(SELECT end_date #{role_query})"
    order(Arel.sql("(#{end_date} IS NULL AND #{start_date} IS NOT NULL) DESC, #{end_date} DESC NULLS LAST, #{start_date} DESC NULLS LAST, experiences.position"))
  }

  # Read-only compatibility for single-role callers. Grouped entries have no single
  # title or date range; callers must use roles rather than flattening their history.
  %w[title start_date end_date].each do |field|
    define_method(field) { roles.size == 1 ? roles.first.public_send(field) : nil }
  end

  library_size_limit :experiences, TextLimits::MAX_EXPERIENCES, "You can save up to #{TextLimits::MAX_EXPERIENCES} roles"

  validates :company, presence: true
  validates :company, :location, length: { maximum: TextLimits::SHORT }
  validates :description, length: { maximum: TextLimits::PROSE }
  validate :highlights_within_limit
  validate :roles_within_limit
  validates_associated :roles

  private

  def roles_within_limit
    total = roles.to_a.count { |role| !role.marked_for_destruction? }
    errors.add(:roles, "must contain at least one title") if total.zero?
    return if total <= TextLimits::MAX_ROLES_PER_EXPERIENCE

    errors.add(:roles, "can contain up to #{TextLimits::MAX_ROLES_PER_EXPERIENCE} titles")
  end

  # Rejects a role with more bullets than a resume section can hold. Uses the in-memory
  # target when it is loaded so unsaved bullets count and a query cannot drop them.
  def highlights_within_limit
    counts = highlights.to_a.reject { |highlight| highlight.marked_for_destruction? || highlight.destroyed? }.group_by(&:experience_role_id).transform_values(&:size)
    return if counts.values.all? { |count| count <= TextLimits::MAX_HIGHLIGHTS_PER_ROLE }

    errors.add(:base, "You can save up to #{TextLimits::MAX_HIGHLIGHTS_PER_ROLE} bullets on a role")
  end
end
