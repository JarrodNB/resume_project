# Description: A user-owned interview practice set, independent of the career library.
# Index:
#   - questions: five ordered question slots, populated atomically by generation
#   - ai_tasks: generation tasks retained for usage accounting after deletion
#   - set_type: immutable general, practical technical, or knowledge scope (legacy default: general)
class InterviewQuestionSet < ApplicationRecord
  SET_TYPES = %w[general technical knowledge].freeze
  enum :set_type, SET_TYPES.index_with(&:itself), validate: true
  attr_readonly :set_type

  belongs_to :user
  has_many :questions, -> { order(:position) }, class_name: "InterviewQuestion",
           dependent: :destroy, inverse_of: :interview_question_set
  has_many :ai_tasks, as: :subject, dependent: :nullify

  validates :number, numericality: { only_integer: true, greater_than: 0 },
                     uniqueness: { scope: :user_id }
end
