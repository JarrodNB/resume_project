# One accepted public utterance. Semantic identities prevent duplicate openings or answers.
# Acknowledgement stays separate from question content so clarification can read only the question.
class InterviewSessionMessage < ApplicationRecord
  include PublishesInterviewSnapshot
  ACKNOWLEDGEMENT_LIMIT = 280
  KINDS = %w[opening answer follow_up closing].freeze
  belongs_to :interview_session
  has_one :career_references, class_name: "InterviewCareerReferences", foreign_key: :message_id, dependent: :destroy
  has_one :clarification, class_name: "InterviewClarification", foreign_key: :message_id, dependent: :destroy
  belongs_to :question, class_name: "InterviewSessionQuestion"
  enum :kind, KINDS.index_with(&:itself), validate: true
  validates :content, :semantic_key, presence: true
  validates :acknowledgement, presence: true, length: { maximum: ACKNOWLEDGEMENT_LIMIT }, allow_nil: true
  validates :acknowledgement, absence: true, if: :answer?
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, uniqueness: { scope: :interview_session_id }
  validates :semantic_key, uniqueness: { scope: :interview_session_id }
end
