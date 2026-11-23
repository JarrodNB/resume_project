# Preserve whether question wording came from the candidate or a model, even after deletion.
class AddWrittenQuestionOrigins < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_question_sets, :origin, :string, null: false, default: "generated"
    add_check_constraint :interview_question_sets, "origin IN ('generated', 'manual')", name: "interview_question_sets_origin_check"
    add_column :avoided_interview_questions, :origin, :string, null: false, default: "generated"
    add_column :avoided_interview_questions, :screened_fields, :jsonb, null: false, default: []
    add_check_constraint :avoided_interview_questions, "origin IN ('generated', 'manual')", name: "avoided_interview_questions_origin_check"
  end
end
