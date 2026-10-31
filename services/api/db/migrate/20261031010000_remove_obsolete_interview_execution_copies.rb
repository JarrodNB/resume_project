# Removes private execution copies after all readers use canonical owned records.
# Deployment requires stopping all old Rails and Python processes before db:prepare.
# Public dialogue, preparation choices and operation/accounting receipts are untouched.
class RemoveObsoleteInterviewExecutionCopies < ActiveRecord::Migration[8.0]
  def change
    remove_check_constraint :interview_session_questions,
      "position >= 0 AND accepted_answer_count BETWEEN 0 AND 3 AND history_version > 0", name: "interview_session_question_counters"
    add_check_constraint :interview_session_questions,
      "position >= 0 AND accepted_answer_count BETWEEN 0 AND 3", name: "interview_session_question_counters"
    remove_check_constraint :interview_session_questions,
      "jsonb_typeof(model_history) = 'array'", name: "interview_session_question_history_array"
    remove_column :interview_sessions, :frozen_context, :jsonb, default: {}, null: false
    remove_column :interview_session_questions, :model_history, :jsonb, default: [], null: false
    remove_column :interview_session_questions, :history_version, :integer, default: 1, null: false
  end
end
