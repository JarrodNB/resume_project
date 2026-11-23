# Gives written practice five distinct scopes. No existing Q&A requires a backfill.
class ExpandWrittenQuestionTypes < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :interview_question_sets, name: "interview_question_sets_valid_set_type"
    change_column_default :interview_question_sets, :set_type, from: "general", to: "fit_motivation"
    add_check_constraint :interview_question_sets,
      "set_type IN ('fit_motivation', 'behavioral', 'hypothetical', 'technical', 'knowledge')",
      name: "interview_question_sets_valid_set_type"
  end

  def down
    remove_check_constraint :interview_question_sets, name: "interview_question_sets_valid_set_type"
    change_column_default :interview_question_sets, :set_type, from: "fit_motivation", to: "general"
    add_check_constraint :interview_question_sets, "set_type IN ('general', 'technical', 'knowledge')",
      name: "interview_question_sets_valid_set_type"
  end
end
