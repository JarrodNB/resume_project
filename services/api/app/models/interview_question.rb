# Description: One interview question with a user-written answer and revision-bound feedback.
# Active questions fill a set's five slots. A retired question is a read-only copy kept when
# an answered slot was replaced, so the user's answer stays in their question bank.
# Index:
#   - interview_question_set: the owning user's practice set
#   - ai_tasks: question operations retained for usage accounting after deletion
#   - embedding: derived current Q&A vector, deleted with its question
class InterviewQuestion < ApplicationRecord
  include ScreenedFields
  belongs_to :interview_question_set, inverse_of: :questions
  has_many :ai_tasks, as: :subject, dependent: :nullify
  has_one :embedding, class_name: "InterviewQuestionEmbedding", dependent: :delete

  scope :active, -> { where(retired_at: nil) }
  scope :retired, -> { where.not(retired_at: nil) }

  validates :position, inclusion: { in: 1..5 }, uniqueness: { scope: :interview_question_set_id }, unless: :retired?
  validates :position, absence: true, if: :retired?
  validates :question_text, presence: true
  validates :answer_text, length: { maximum: TextLimits::INTERVIEW_ANSWER }
  validates :question_revision, numericality: { only_integer: true, greater_than: 0 }
  validates :answer_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :feedback_question_revision, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :feedback_answer_revision, numericality: { only_integer: true, greater_than_or_equal_to: 0 }, allow_nil: true

  def retired? = retired_at.present?
end
