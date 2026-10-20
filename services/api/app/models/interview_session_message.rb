# One accepted public utterance. Semantic identities prevent duplicate openings or answers.
class InterviewSessionMessage < ApplicationRecord
  KINDS = %w[opening answer follow_up closing].freeze
  belongs_to :interview_session
  belongs_to :question, class_name: "InterviewSessionQuestion"
  enum :kind, KINDS.index_with(&:itself), validate: true
  validates :content, :semantic_key, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, uniqueness: { scope: :interview_session_id }
  validates :semantic_key, uniqueness: { scope: :interview_session_id }
end
