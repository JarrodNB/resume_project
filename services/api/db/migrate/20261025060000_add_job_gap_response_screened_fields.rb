# Saved job-only answers start unchecked and earn approvals on their first model use.
class AddJobGapResponseScreenedFields < ActiveRecord::Migration[8.1]
  def change
    add_column :job_gap_responses, :screened_fields, :text, array: true, default: [], null: false
  end
end
