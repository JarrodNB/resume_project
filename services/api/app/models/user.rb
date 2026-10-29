# An account holder authenticated by Devise and server-side browser sessions.
# New passwords use Devise's length and offline common-password checks plus bcrypt's byte limit;
# existing passwords stay usable until the account holder chooses a replacement.
# Index:
#   - profile columns: name, contact_email, phone, location, links, summary
#   - include_summary: default for new resumes; never changes existing resume output
#   - career library: experiences, projects, educations (most recent first), certifications (issued date), skills (by position),
#     career_contexts (answers the user added from gap analysis, by created_at)
#   - jobs, resumes, ai_tasks, ai_task_outcomes, interview_question_sets, interview_sessions, chat_conversations
#   - library_embeddings: vectors of the career library entries (derived data)
class User < ApplicationRecord
  devise :database_authenticatable, :registerable, :validatable, :uncommon_password, :confirmable, :recoverable

  has_many :experiences, -> { most_recent_first }, dependent: :destroy
  has_many :projects, -> { most_recent_first }, dependent: :destroy
  has_many :educations, -> { most_recent_first }, dependent: :destroy
  has_many :certifications, -> { order(Arel.sql("issued_date DESC NULLS LAST"), :position, :id) }, dependent: :destroy
  has_many :skills, -> { order(:position) }, dependent: :destroy
  has_many :career_contexts, -> { order(:created_at) }, dependent: :destroy
  has_many :chat_conversations, dependent: :destroy
  has_many :jobs, dependent: :destroy
  has_many :resumes, dependent: :destroy
  has_many :avoided_interview_questions, dependent: :destroy
  has_many :interview_question_sets, -> { order(created_at: :desc, id: :desc) }, dependent: :destroy
  has_many :interview_sessions, -> { order(created_at: :desc, id: :desc) }, dependent: :destroy
  has_many :ai_task_outcomes, dependent: :delete_all
  has_many :ai_tasks, dependent: :destroy
  has_many :ai_embedding_requests, dependent: :delete_all
  has_many :library_embeddings, dependent: :delete_all

  validates :include_summary, inclusion: { in: [ true, false ] }

  validates :name, :contact_email, :phone, :location, length: { maximum: TextLimits::SHORT }
  validates :summary, length: { maximum: TextLimits::PROSE }
  validate :links_within_limits
  validate :password_safe_for_bcrypt

  # bcrypt cannot hash NUL bytes or non-text input. Keep invalid values for validation without
  # calling its eager hasher; ordinary passwords still use Devise unchanged.
  def password=(value)
    return @password = value unless value.nil? || (value.is_a?(String) && !value.include?("\0"))

    super
  end

  # Malformed credentials get the same failed-login result as any incorrect password.
  def valid_password?(value)
    return false unless value.is_a?(String) && !value.include?("\0")

    super
  end

  # Standard Devise integration: Rails owns asynchronous delivery and retries, not the AI queues.
  def send_devise_notification(notification, *args)
    devise_mailer.send(notification, self, *args).deliver_later
  end

  private

  def password_safe_for_bcrypt
    return if password.nil?
    unless password.is_a?(String)
      errors.add(:password, "must be text")
      return
    end
    return unless password_required?

    errors.add(:password, "cannot contain a null character") if password.include?("\0")
    if password.bytesize > 72
      errors.add(:password, "must be 72 bytes or fewer (some characters use more than one byte)")
    end
  end

  # devise-uncommon_password 0.4.9 assumes a value on new records; let Devise's
  # presence/type validations report malformed passwords instead of raising on downcase.
  def not_common_password
    super if password.is_a?(String)
  end

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
