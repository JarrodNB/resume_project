# Saved jobs start unchecked and earn field approvals only when used by an AI task.
class AddJobScreenedFields < ActiveRecord::Migration[8.1]
  def change
    add_column :jobs, :screened_fields, :text, array: true, default: [], null: false
  end
end
