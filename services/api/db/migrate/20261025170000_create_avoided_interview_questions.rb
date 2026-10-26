# Keep avoided question text independently of the practice/session record it came from.
class CreateAvoidedInterviewQuestions < ActiveRecord::Migration[8.1]
  def change
    create_table :avoided_interview_questions, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true
      t.text :question_text, null: false
      t.string :text_digest, null: false, limit: 64
      t.timestamps
    end
    add_index :avoided_interview_questions, [ :user_id, :text_digest ], unique: true
    add_check_constraint :avoided_interview_questions, "char_length(question_text) BETWEEN 1 AND 2000", name: "avoided_question_text_length"
  end
end
