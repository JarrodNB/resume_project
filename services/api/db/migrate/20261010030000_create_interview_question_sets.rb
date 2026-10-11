# Description: Persists user-owned interview practice sets and their ordered questions.
# Index:
#   - change: creates sets, questions, revision metadata, and integrity constraints
class CreateInterviewQuestionSets < ActiveRecord::Migration[8.1]
  # Creates practice storage independently of the career library.
  def change
    create_table :interview_question_sets, id: :uuid do |t|
      t.references :user, type: :uuid, null: false, foreign_key: true
      t.integer :number, null: false
      t.timestamps
      t.index [ :user_id, :number ], unique: true
    end
    add_check_constraint :interview_question_sets, "number > 0", name: "interview_set_positive_number"

    create_table :interview_questions, id: :uuid do |t|
      t.references :interview_question_set, type: :uuid, null: false, foreign_key: true
      t.integer :position, null: false
      t.text :question_text, null: false
      t.text :answer_text, null: false, default: ""
      t.integer :question_revision, null: false, default: 1
      t.integer :answer_revision, null: false, default: 0
      t.jsonb :feedback, null: false, default: {}
      t.integer :feedback_question_revision
      t.integer :feedback_answer_revision
      t.timestamps
      t.index [ :interview_question_set_id, :position ], unique: true
    end
    add_check_constraint :interview_questions, "position BETWEEN 1 AND 5", name: "interview_question_position"
    add_check_constraint :interview_questions,
                         "question_revision > 0 AND answer_revision >= 0",
                         name: "interview_question_revisions"
  end
end
