# Description: An account holder. Authenticates with Devise; API requests carry a JWT.
# Index:
#   - profile columns: name, contact_email, phone, location, links, summary
#   - career library: experiences, projects, educations (most recent first), skills (by position),
#     library_facts (answers the user added from gap analysis, by created_at)
#   - jobs, resumes, ai_tasks
#   - library_embeddings: vectors of the career library entries (derived data)
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :experiences, -> { most_recent_first }, dependent: :destroy
  has_many :projects, -> { most_recent_first }, dependent: :destroy
  has_many :educations, -> { most_recent_first }, dependent: :destroy
  has_many :skills, -> { order(:position) }, dependent: :destroy
  has_many :library_facts, -> { order(:created_at) }, dependent: :destroy
  has_many :jobs, dependent: :destroy
  has_many :resumes, dependent: :destroy
  has_many :ai_tasks, dependent: :destroy
  has_many :library_embeddings, dependent: :delete_all

  validates :name, :contact_email, :phone, :location, length: { maximum: TextLimits::SHORT }
  validates :summary, length: { maximum: TextLimits::PROSE }
  validate :links_within_limits

  private

  # Caps how many links the profile holds and how long each one is.
  def links_within_limits
    return unless links.is_a?(Array)

    errors.add(:base, "You can save up to #{TextLimits::MAX_LINKS} links") if links.size > TextLimits::MAX_LINKS
    return unless links.any? { |link| link.to_s.length > TextLimits::SHORT }

    errors.add(:links, "is too long (maximum is #{TextLimits::SHORT} characters)")
  end
end
