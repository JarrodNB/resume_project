# Description: An account holder. Authenticates with Devise; API requests carry a JWT.
# Index:
#   - profile columns: name, contact_email, phone, location, links, summary
#   - career library: experiences, projects, educations (most recent first), certifications (issued date), skills (by position),
#     library_facts (answers the user added from gap analysis, by created_at)
#   - jobs, resumes, ai_tasks, interview_question_sets
#   - library_embeddings: vectors of the career library entries (derived data)
#   - screening_decisions: successful exact-content screening checks owned by this account
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :validatable,
         :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  has_many :experiences, -> { most_recent_first }, dependent: :destroy
  has_many :projects, -> { most_recent_first }, dependent: :destroy
  has_many :educations, -> { most_recent_first }, dependent: :destroy
  has_many :certifications, -> { order(Arel.sql("issued_date DESC NULLS LAST"), :position, :id) }, dependent: :destroy
  has_many :skills, -> { order(:position) }, dependent: :destroy
  has_many :library_facts, -> { order(:created_at) }, dependent: :destroy
  has_many :jobs, dependent: :destroy
  has_many :resumes, dependent: :destroy
  has_many :interview_question_sets, -> { order(created_at: :desc, id: :desc) }, dependent: :destroy
  has_many :ai_tasks, dependent: :destroy
  has_many :library_embeddings, dependent: :delete_all
  has_many :screening_decisions, dependent: :delete_all

  validates :name, :contact_email, :phone, :location, length: { maximum: TextLimits::SHORT }
  validates :summary, length: { maximum: TextLimits::PROSE }
  validate :links_within_limits

  private

  # Caps how many links the profile holds and how long each one is.
  def links_within_limits
    return unless links.is_a?(Array)

    errors.add(:base, "You can save up to #{TextLimits::MAX_LINKS} links") if links.size > TextLimits::MAX_LINKS
    invalid_shape = links.any? do |link|
      link.is_a?(String) ? link.blank? : !link.is_a?(Hash) || link["label"].blank? || link["url"].blank?
    end
    errors.add(:links, "must include a label and URL") if invalid_shape
    too_long = links.any? do |link|
      values = link.is_a?(Hash) ? [ link["label"], link["url"] ] : [ link ]
      values.any? { |value| value.to_s.length > TextLimits::SHORT }
    end
    errors.add(:links, "is too long (maximum is #{TextLimits::SHORT} characters)") if too_long
  end
end
