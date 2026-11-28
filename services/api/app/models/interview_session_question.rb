# A prepared question and answer count; accepted dialogue lives in session messages.
# Live interviews also keep the interviewer's latest spoken feedback as text and how many
# times the candidate restarted the question.
class InterviewSessionQuestion < ApplicationRecord
  LIVE_FEEDBACK_LIMIT = 1_500
  LIVE_RETRY_LIMIT = 2
  self.ignored_columns += %w[model_history history_version]
  validates :question_type, inclusion: { in: %w[behavioral technical knowledge screening] }
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  has_many :messages, class_name: "InterviewSessionMessage", foreign_key: :question_id, dependent: :destroy
  validates :content, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, uniqueness: { scope: :interview_session_id }
  validates :accepted_answer_count, inclusion: { in: 0..3 }
  validates :live_feedback, length: { in: 1..LIVE_FEEDBACK_LIMIT }, allow_nil: true
  validates :live_retry_count, inclusion: { in: 0..LIVE_RETRY_LIMIT }
end
