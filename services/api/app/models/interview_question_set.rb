# Description: A user-owned interview practice set, independent of the career library.
# Index:
#   - questions: five ordered question slots, populated atomically by generation
#   - ai_tasks: generation tasks retained for usage accounting after deletion
class InterviewQuestionSet < ApplicationRecord
  belongs_to :user
  has_many :questions, -> { order(:position) }, class_name: "InterviewQuestion",
           dependent: :destroy, inverse_of: :interview_question_set
  has_many :ai_tasks, as: :subject, dependent: :nullify

  validates :number, numericality: { only_integer: true, greater_than: 0 },
                     uniqueness: { scope: :user_id }
end
