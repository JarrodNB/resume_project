# An account's durable request to avoid a question, independent of its original source.
class AvoidedInterviewQuestion < ApplicationRecord
  include ScreenedFields
  screenable_fields %w[question_text]
  enum :origin, %w[generated manual].index_with(&:itself), validate: true
  attr_readonly :origin, :question_text, :text_digest
  belongs_to :user
  validates :question_text, presence: true, length: { maximum: 2000 }
  validates :text_digest, presence: true, uniqueness: { scope: :user_id }
end
