# Written practice fields start unchecked and earn reusable checks through actual model use.
class AddInterviewQuestionScreenedFields < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_questions, :screened_fields, :text, array: true, default: [], null: false
  end
end
