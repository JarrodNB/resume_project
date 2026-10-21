# A prepared question and its accepted execution history, separate from public dialogue.
class InterviewSessionQuestion < ApplicationRecord
  validates :question_type, inclusion: { in: %w[behavioral technical knowledge] }
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  has_many :messages, class_name: "InterviewSessionMessage", foreign_key: :question_id, dependent: :destroy
  validates :content, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, uniqueness: { scope: :interview_session_id }
  validates :accepted_answer_count, inclusion: { in: 0..2 }
  validates :history_version, inclusion: { in: [ 1 ] }
end
