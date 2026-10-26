# An account's durable request to avoid a question, independent of its original source.
class AvoidedInterviewQuestion < ApplicationRecord
  belongs_to :user
  validates :question_text, presence: true, length: { maximum: 2000 }
  validates :text_digest, presence: true, uniqueness: { scope: :user_id }
end
