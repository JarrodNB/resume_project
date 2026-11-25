# Stores alternative written drafts without copying or rewriting existing plain-text answers.
class AddInterviewAnswerFormats < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_questions, :answer_format, :string, null: false, default: "plain_text"
    add_column :interview_questions, :answer_format_revision, :integer, null: false, default: 0
    add_column :interview_questions, :answer_drafts, :jsonb, null: false, default: {}
  end
end
