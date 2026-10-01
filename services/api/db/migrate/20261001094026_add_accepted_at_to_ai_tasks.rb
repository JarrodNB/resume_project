# Description: Records when the user accepted an AI task's result into their data (e.g. imported
# a parsed resume), so the same result can't be imported twice.
class AddAcceptedAtToAiTasks < ActiveRecord::Migration[8.1]
  def change
    add_column :ai_tasks, :accepted_at, :datetime
  end
end
