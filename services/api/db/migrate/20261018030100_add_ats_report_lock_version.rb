# Order report changes even when more than one update shares a timestamp.
class AddAtsReportLockVersion < ActiveRecord::Migration[8.1]
  def change
    add_column :ats_check_runs, :lock_version, :bigint, default: 0, null: false
  end
end
