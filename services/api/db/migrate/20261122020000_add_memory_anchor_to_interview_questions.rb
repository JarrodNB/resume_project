# Stores private recall cues beside answers; cues never become model evidence.
class AddMemoryAnchorToInterviewQuestions < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_questions, :memory_anchor, :string, limit: 200, null: false, default: ""
  end
end
