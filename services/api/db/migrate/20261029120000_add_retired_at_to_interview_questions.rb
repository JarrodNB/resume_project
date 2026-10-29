# Lets a replaced question keep its written answer as a read-only, slotless copy.
# Active questions still fill positions 1–5; retired copies have no position.
class AddRetiredAtToInterviewQuestions < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_questions, :retired_at, :datetime
    change_column_null :interview_questions, :position, true
    remove_check_constraint :interview_questions, "\"position\" >= 1 AND \"position\" <= 5",
      name: "interview_question_position"
    add_check_constraint :interview_questions,
      "(retired_at IS NULL AND \"position\" IS NOT NULL AND \"position\" BETWEEN 1 AND 5) OR (retired_at IS NOT NULL AND \"position\" IS NULL)",
      name: "interview_question_position"
  end
end
