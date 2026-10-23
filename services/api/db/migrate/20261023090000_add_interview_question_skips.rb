# Keeps skip identity on the core question so retries cannot skip a later question.
class AddInterviewQuestionSkips < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_session_questions, :skipped_at, :datetime
    add_column :interview_session_questions, :skip_submission_key, :string
    add_column :interview_session_questions, :skip_expected_revision, :integer
    add_index :interview_session_questions, [ :interview_session_id, :skip_submission_key ], unique: true, name: "interview_question_skip_identity"
  end
end
