# Description: A user-owned interview practice set, independent of the career library.
# Index:
#   - questions: five generated slots or one candidate-written question
#   - retired_questions: read-only answered copies kept when a slot was replaced
#   - ai_tasks: generation tasks retained for usage accounting after deletion
#   - set_type: immutable practice scope used by generation and feedback
class InterviewQuestionSet < ApplicationRecord
  SET_TYPES = %w[fit_motivation behavioral hypothetical technical knowledge].freeze
  enum :set_type, SET_TYPES.index_with(&:itself), validate: true
  enum :origin, %w[generated manual].index_with(&:itself), validate: true
  attr_readonly :set_type, :origin

  belongs_to :user
  has_many :questions, -> { active.order(:position) }, class_name: "InterviewQuestion",
           dependent: :destroy, inverse_of: :interview_question_set
  has_many :retired_questions, -> { retired.order(:retired_at, :id) }, class_name: "InterviewQuestion",
           dependent: :destroy, inverse_of: :interview_question_set
  has_many :ai_tasks, as: :subject, dependent: :nullify

  validates :number, numericality: { only_integer: true, greater_than: 0 },
                     uniqueness: { scope: :user_id }
end
